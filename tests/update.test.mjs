import test from 'node:test';
import assert from 'node:assert/strict';
import { updateCatalog, refreshItem, parserVersion, sourceFingerprint } from '../scripts/update-catalog.mjs';
import { requestItems, ApiFailure } from '../scripts/fetch-catalog.mjs';

const at = '2026-10-03T03:00:00.000Z';
const before = '2026-09-01T03:00:00Z';
const raw = (id = 'shop:a', changes = {}) => ({ itemCode: id, itemName: '本棚 幅60 高さ180', itemCaption: '本体サイズ：幅60cm 奥行30cm 高さ180cm', catchcopy: '', itemPrice: 5000, availability: 1, taxFlag: 0, itemUrl: `https://item.rakuten.co.jp/shop/${id.split(':')[1]}/`, shopName: '店舗', ...changes });
const item = (id = 'shop:a') => refreshItem(raw(id), '本棚', null, before);
const catalog = (items = [item()]) => ({ version: 1, status: 'ok', generatedAt: before, failedCategories: [], categories: ['本棚'], items });
const options = extra => ({ appId: 'synthetic-app', accessKey: 'synthetic-key', sleep: async () => {}, now: () => new Date(at), categories: ['本棚'], pages: 1, ...extra });

test('exact lookup uses itemCode and availability=0, without discovery keywords', async () => {
  await requestItems({ ...options(), itemCode: 'shop:a', fetchImpl: async (url, init) => {
    assert.equal(url.searchParams.get('itemCode'), 'shop:a');
    assert.equal(url.searchParams.get('availability'), '0');
    assert.equal(url.searchParams.has('keyword'), false);
    assert.equal(init.headers.accessKey, 'synthetic-key');
    return { ok: true, status: 200, json: async () => ({ items: [raw()], pageCount: 1 }) };
  } });
});

test('monthly merge adds new products, updates metadata and price, preserves firstSeenAt and reuses unchanged dimensions', async () => {
  const previous = catalog([item(), item('shop:missing')]);
  const original = JSON.stringify(previous);
  const updated = await updateCatalog(previous, options({ request: async ({ itemCode }) => itemCode ? { items: [], pageCount: 0 } : { items: [raw('shop:a', { itemPrice: 4000, shopName: '更新店舗' }), raw('shop:new')], pageCount: 1 } }));
  assert.equal(updated.items.length, 3);
  const existing = updated.items.find(i => i.id === 'shop:a');
  assert.equal(existing.firstSeenAt, before);
  assert.equal(existing.lastSeenAt, at);
  assert.equal(existing.lastUpdatedAt, at);
  assert.equal(existing.price, 4000);
  assert.equal(existing.previousPrice, 5000);
  assert.equal(existing.priceChangedAt, at);
  assert.equal(existing.shop, '更新店舗');
  assert.equal(existing.dimensions, previous.items[0].dimensions);
  assert.equal(updated.items.find(i => i.id === 'shop:new').firstSeenAt, at);
  const missing = updated.items.find(i => i.id === 'shop:missing');
  assert.equal(missing.missingChecks, 1);
  assert.equal(missing.saleEndCandidate, false);
  assert.equal(missing.lastSeenAt, before);
  assert.equal(missing.lastUpdatedAt, before);
  assert.equal(JSON.stringify(previous), original);
  assert.equal(updated.lastDiscoveryAt, at);
  assert.equal(updated.update.requests, 2);
});

test('caption/name/catchcopy or parser change invalidates reused dimensions; no raw description stored', () => {
  const old = item();
  for (const changes of [{ itemCaption: '本体サイズ：幅60cm 奥行30cm 高さ70cm', itemName: '本棚 幅60 高さ70' }, { catchcopy: '高さ180cm' }, { itemName: '新しい本棚 高さ180cm' }]) {
    const updated = refreshItem(raw('shop:a', changes), '本棚', old, at);
    assert.notEqual(updated.dimensionSourceHash, old.dimensionSourceHash);
    assert.notEqual(updated.dimensionBounds, old.dimensionBounds);
  }
  const changed = refreshItem(raw(), '本棚', { ...old, dimensionParserVersion: 'old' }, at);
  assert.equal(changed.dimensionParserVersion, parserVersion);
  assert.notEqual(changed.dimensions, old.dimensions);
  assert.equal('itemCaption' in changed, false);
  assert.equal(sourceFingerprint(raw()), old.dimensionSourceHash);
});

test('sale mode checks only saved IDs, updates unavailable goods, and does not explore or add new products', async () => {
  const previous = catalog([item(), item('shop:b')]);
  const requested = [];
  const updated = await updateCatalog(previous, options({ mode: 'prices', request: async ({ itemCode, keyword }) => {
    assert.equal(keyword, undefined);
    requested.push(itemCode);
    return { items: [raw(itemCode, { availability: itemCode === 'shop:a' ? 0 : 1, itemPrice: 3000 })], pageCount: 1 };
  } }));
  assert.deepEqual(requested, ['shop:a', 'shop:b']);
  assert.equal(updated.items[0].availability, 0);
  assert.equal(updated.items[0].saleEndCandidate, false);
  assert.equal(updated.items[0].firstSeenAt, before);
  assert.equal(updated.items[0].lastSeenAt, at);
  assert.equal(updated.lastDiscoveryAt, null);
  assert.equal(updated.update.added, 0);
});

test('missing products remain indefinitely; repeated successful exact misses mark candidate and return resets it', async () => {
  const request = async ({ itemCode }) => ({ items: itemCode === 'shop:a' ? [] : [raw('shop:b')], pageCount: 1 });
  const first = await updateCatalog(catalog([item(), item('shop:b')]), options({ mode: 'prices', request }));
  const second = await updateCatalog(first, options({ mode: 'prices', request }));
  assert.equal(second.items.length, 2);
  assert.equal(second.items[0].saleEndCandidate, true);
  assert.equal(second.items[0].lastUpdatedAt, before);
  const returned = await updateCatalog(second, options({ mode: 'prices', request: async ({ itemCode }) => ({ items: [raw(itemCode)], pageCount: 1 }) }));
  assert.equal(returned.items[0].saleEndCandidate, false);
  assert.equal(returned.items[0].missingChecks, 0);
});

test('partial discovery, network/auth failure, invalid lookup and globally empty responses cannot replace last good state', async () => {
  const previous = catalog();
  const original = JSON.stringify(previous);
  const requests = [
    async () => { throw new ApiFailure('HTTP_503'); },
    async () => { throw new ApiFailure('HTTP_401'); },
    async () => ({ items: [], pageCount: 0 }),
    async () => ({ items: [raw('shop:wrong')], pageCount: 1 }),
    async () => ({ items: [raw('shop:a', { itemUrl: 'https://evil.test' })], pageCount: 1 }),
  ];
  for (const request of requests) {
    await assert.rejects(updateCatalog(previous, options({ mode: 'prices', request })));
    assert.equal(JSON.stringify(previous), original);
  }
  await assert.rejects(updateCatalog(previous, options({ request: async () => { throw new ApiFailure('HTTP_503'); } })), /INCOMPLETE_DISCOVERY/);
  await assert.rejects(updateCatalog(previous, options({ request: async () => ({ items: [], pageCount: 0 }) })), /INCOMPLETE_DISCOVERY/);
  await assert.rejects(updateCatalog(previous, options({ appId: undefined })), /MISSING_SECRETS/);
  assert.equal(JSON.stringify(previous), original);
});

test('legacy catalog gains timestamps and dimension fingerprint on first successful refresh', async () => {
  const legacy = item();
  for (const key of ['firstSeenAt', 'lastSeenAt', 'lastUpdatedAt', 'dimensionSourceHash', 'dimensionParserVersion']) delete legacy[key];
  const updated = await updateCatalog(catalog([legacy]), options({ mode: 'prices', request: async () => ({ items: [raw()], pageCount: 1 }) }));
  assert.equal(updated.items[0].firstSeenAt, before);
  assert.equal(updated.items[0].lastSeenAt, at);
  assert.equal(updated.items[0].dimensionParserVersion, parserVersion);
});

test('one failed category or one failed lookup after successful lookups aborts without altering base', async () => {
  const previous = catalog([item(), item('shop:b')]);
  const original = JSON.stringify(previous);
  await assert.rejects(updateCatalog(previous, options({ categories: ['本棚', 'チェスト'], request: async ({ keyword }) => {
    if (keyword === 'チェスト') throw new ApiFailure('HTTP_503');
    return { items: [raw()], pageCount: 1 };
  } })), /INCOMPLETE_DISCOVERY/);
  await assert.rejects(updateCatalog(previous, options({ mode: 'prices', request: async ({ itemCode }) => {
    if (itemCode === 'shop:b') throw new ApiFailure('NETWORK');
    return { items: [raw(itemCode, { itemPrice: 1 })], pageCount: 1 };
  } })), /NETWORK/);
  assert.equal(JSON.stringify(previous), original);
});

test('missing source text aborts instead of overwriting safe dimension analysis with incomplete data', async () => {
  const incomplete = raw();
  delete incomplete.itemCaption;
  await assert.rejects(updateCatalog(catalog(), options({ mode: 'prices', request: async () => ({ items: [incomplete], pageCount: 1 }) })), /INCOMPLETE_ITEM/);
});
