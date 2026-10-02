import test from 'node:test';
import assert from 'node:assert/strict';
import { searchProducts, validConditions, safeRakutenUrl, validateCatalog } from '../lib.mjs';

const size = { width: 80, depth: 40, height: 120, evidence: '本体サイズ：幅80×奥行40×高さ120cm' };
const conditions = { width: 80, depth: 40, height: 120, budget: 20000, includeUnknown: true, sort: 'price-asc', category: '' };
const product = (id, price, dimensions = size, extra = {}) => ({ id, price, dimensions, categories: ['本棚'], name: '収納棚', shop: '店舗', url: 'https://item.rakuten.co.jp/shop/item/', ...extra });

test('all three maximum dimensions and budget are inclusive', () => {
  const products = [product('fit', 20000), product('too-wide', 100, { ...size, width: 80.1 }), product('too-deep', 100, { ...size, depth: 40.1 }), product('too-high', 100, { ...size, height: 120.1 }), product('over-budget', 20001)];
  assert.deepEqual(searchProducts(products, conditions).map(item => item.id), ['fit']);
});
test('known matches rank before cheaper unknowns; price sort within each group', () => {
  const products = [product('unknown', 100, null), product('expensive', 10000), product('cheap', 1000)];
  assert.deepEqual(searchProducts(products, conditions).map(item => item.id), ['cheap', 'expensive', 'unknown']);
  assert.deepEqual(searchProducts(products, { ...conditions, sort: 'price-desc' }).map(item => item.id), ['expensive', 'cheap', 'unknown']);
});
test('unknown checkbox and categories filter actual candidate coverage', () => {
  const products = [product('fit', 1000), product('unknown', 100, null), product('cabinet', 1000, size, { categories: ['キャビネット'] })];
  assert.deepEqual(searchProducts(products, { ...conditions, includeUnknown: false, category: '本棚' }).map(item => item.id), ['fit']);
});
test('price ranges use upper price, not unrelated cheapest variant', () => {
  assert.equal(searchProducts([product('range', 1000, size, { priceMax: 25000 })], conditions).length, 0);
  assert.equal(searchProducts([product('range', 1000, size, { priceMax: 20000 })], conditions).length, 1);
});
test('zero matching products is a valid empty result', () => assert.deepEqual(searchProducts([], conditions), []));
test('invalid numeric conditions are rejected', () => {
  for (const value of [0, -1, NaN, Infinity, '80', 1001]) assert.equal(validConditions({ ...conditions, width: value }), false);
  assert.equal(validConditions({ ...conditions, budget: 0.5 }), false);
  assert.throws(() => searchProducts([], { ...conditions, width: NaN }), /INVALID_CONDITIONS/);
});
test('old catalog remains searchable and known unavailable goods are retained but not recommended', () => {
  const data = validateCatalog({ version: 1, status: 'ok', generatedAt: '2020-01-01T00:00:00Z', failedCategories: [], items: [product('old', 1000), product('unavailable', 1000, size, { availability: 0 })] });
  assert.deepEqual(searchProducts(data.items, conditions).map(item => item.id), ['old']);
});
test('unsafe external product and image URLs cannot reach the DOM', () => {
  for (const url of ['javascript:alert(1)', 'https://item.rakuten.co.jp.evil.test/item', 'https://evil.test/item', 'http://item.rakuten.co.jp/item', 'https://user:pass@item.rakuten.co.jp/item']) assert.equal(safeRakutenUrl(url), null);
  assert.ok(safeRakutenUrl('https://item.rakuten.co.jp/shop/item/'));
  assert.ok(safeRakutenUrl('https://thumbnail.image.rakuten.co.jp/image/', true));
});
test('application tracking identifiers are removed from public URLs', () => {
  assert.equal(safeRakutenUrl('https://item.rakuten.co.jp/shop/item/?rafcid=test-app-only&scid=test-access-only#test-app-only'), 'https://item.rakuten.co.jp/shop/item/');
  assert.equal(safeRakutenUrl('https://thumbnail.image.rakuten.co.jp/image/?_ex=128x128&applicationId=test-app-only', true), 'https://thumbnail.image.rakuten.co.jp/image/?_ex=128x128');
});
test('malformed catalog cannot silently present broken product data', () => {
  const data = { version: 1, status: 'ok', generatedAt: new Date().toISOString(), failedCategories: [], items: [product('a', 1000)] };
  assert.equal(validateCatalog(data), data);
  for (const item of [product('a', 0), product('a', 100, size, { url: 'https://evil.test' }), product('a', 100, { ...size, width: Infinity }), product('a', 100, size, { priceMax: 1 })]) assert.throws(() => validateCatalog({ ...data, items: [item] }), /INVALID_CATALOG/);
});
