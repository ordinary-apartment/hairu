import test from 'node:test';
import assert from 'node:assert/strict';
import { requestItems, normalizeItem, fetchCatalog, ensureNoSecrets, ApiFailure, ENDPOINT } from '../scripts/fetch-catalog.mjs';

const raw = { itemCode: 'shop:item', itemName: '収納棚 幅80cm', itemPrice: 10000, itemPriceMax3: 10000, availability: 1, taxFlag: 0, postageFlag: 0, shopName: '店舗', itemUrl: 'https://item.rakuten.co.jp/shop/item/', mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/image/'], itemCaption: '本体サイズ：幅80×奥行40×高さ120cm' };
const sleep = async () => {};
const credentials = { appId: 'test-app-only', accessKey: 'test-access-only', keyword: '本棚', page: 1, sleep };
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('current endpoint receives both credentials; Access Key is only in header', async () => {
  const result = await requestItems({ ...credentials, fetchImpl: async (url, options) => {
    assert.equal(url.origin + url.pathname, ENDPOINT);
    assert.equal(url.searchParams.get('applicationId'), credentials.appId);
    assert.equal(options.headers.accessKey, credentials.accessKey);
    assert.equal(url.searchParams.has('accessKey'), false);
    assert.equal(url.searchParams.has('affiliateId'), false);
    assert.equal(url.searchParams.get('genreId'), '200166');
    assert.equal(options.redirect, 'error');
    return response(200, { Items: [raw], pageCount: 1 });
  }});
  assert.equal(result.items.length, 1);
});
test('rate limits and transient failures retry with bounded attempts', async () => {
  let calls = 0;
  const waits = [];
  await requestItems({ ...credentials, sleep: async ms => waits.push(ms), fetchImpl: async () => response(++calls < 3 ? 429 : 200, { Items: [], pageCount: 0 }) });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 4000]);
});
test('authentication and network failures never expose raw errors or request URLs', async () => {
  await assert.rejects(requestItems({ ...credentials, fetchImpl: async () => response(400, { error_description: credentials.accessKey }) }), { message: 'HTTP_400' });
  await assert.rejects(requestItems({ ...credentials, fetchImpl: async () => { throw new Error(credentials.accessKey); } }), { message: 'NETWORK' });
  await assert.rejects(requestItems({ ...credentials, fetchImpl: async () => response(503, {}) }), { message: 'HTTP_503' });
});
test('404 is empty, invalid payloads are errors', async () => {
  assert.deepEqual(await requestItems({ ...credentials, fetchImpl: async () => response(404, {}) }), { items: [], pageCount: 0 });
  await assert.rejects(requestItems({ ...credentials, fetchImpl: async () => response(200, { error: 'wrong_parameter' }) }), { message: 'INVALID_RESPONSE' });
  await assert.rejects(requestItems({ ...credentials, fetchImpl: async () => ({ status: 200, ok: true, json: async () => { throw new Error('bad'); } }) }), { message: 'INVALID_JSON' });
});
test('normalizer whitelists public fields and rejects unavailable/unsafe products', () => {
  const item = normalizeItem({ ...raw, accessKey: 'not copied', affiliateUrl: 'not copied' }, '本棚');
  assert.equal(item.priceMax, null);
  assert.equal(item.dimensions.width, 80);
  assert.equal(item.accessKey, undefined);
  assert.equal(item.itemCaption, undefined);
  assert.equal(item.affiliateUrl, undefined);
  for (const override of [{ availability: 0 }, { taxFlag: 1 }, { itemUrl: 'javascript:alert(1)' }, { itemPrice: -1 }, { itemName: '専用天板' }]) assert.equal(normalizeItem({ ...raw, ...override }, '本棚'), null);
  assert.equal(normalizeItem({ ...raw, mediumImageUrls: [{ imageUrl: raw.mediumImageUrls[0] }] }, '本棚').image, raw.mediumImageUrls[0]);
});
test('API tracking URLs cannot copy credentials into the public catalog', () => {
  const item = normalizeItem({ ...raw, itemUrl: `${raw.itemUrl}?rafcid=${credentials.appId}` }, '本棚');
  ensureNoSecrets(JSON.stringify(item), [credentials.appId, credentials.accessKey]);
  assert.equal(item.url, raw.itemUrl);
});
test('catalog deduplicates products across categories and reports partial failure', async () => {
  const catalog = await fetchCatalog({ ...credentials, sleep, categories: ['本棚', 'チェスト', 'キャビネット'], request: async ({ keyword }) => {
    if (keyword === 'キャビネット') throw new ApiFailure('HTTP_429');
    return { items: [raw], pageCount: 1 };
  }});
  assert.equal(catalog.status, 'partial');
  assert.equal(catalog.items.length, 1);
  assert.deepEqual(catalog.items[0].categories, ['本棚', 'チェスト']);
  assert.deepEqual(catalog.failedCategories, [{ category: 'キャビネット', code: 'HTTP_429' }]);
});
test('all-failed or missing credentials produces honest unavailable status', async () => {
  const missing = await fetchCatalog({ sleep, categories: ['本棚'] });
  assert.equal(missing.status, 'unavailable');
  assert.deepEqual(missing.items, []);
  const failed = await fetchCatalog({ ...credentials, sleep, categories: ['本棚'], request: async () => { throw new Error(credentials.accessKey); } });
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.failedCategories[0].code, 'REQUEST_FAILED');
  assert.equal(JSON.stringify(failed).includes(credentials.accessKey), false);
});
test('zero items after successful query is not an API failure', async () => {
  const result = await fetchCatalog({ ...credentials, sleep, categories: ['本棚'], request: async () => ({ items: [], pageCount: 0 }) });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.items, []);
});
test('output guard blocks plaintext or encoded secrets', () => {
  assert.throws(() => ensureNoSecrets('secret=a/b', ['a/b']), /SECRET_IN_OUTPUT/);
  assert.throws(() => ensureNoSecrets('secret=a%2Fb', ['a/b']), /SECRET_IN_OUTPUT/);
  assert.doesNotThrow(() => ensureNoSecrets('{"name":"収納"}', [credentials.appId, credentials.accessKey]));
});
