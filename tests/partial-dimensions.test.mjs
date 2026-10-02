import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDimensionBounds } from '../scripts/dimensions.mjs';
import { normalizeItem } from '../scripts/fetch-catalog.mjs';
import { searchProducts, validateCatalog } from '../lib.mjs';

const conditions = { width: 60.3, depth: 60.2, height: 70, budget: 20000, includeUnknown: true, category: '', sort: 'price-asc' };
function item(name, caption = '', catchcopy = '') {
  return normalizeItem({ itemCode: 'shop:bookcase', itemName: name, itemCaption: caption, catchcopy, itemPrice: 1000, taxFlag: 0, availability: 1, itemUrl: 'https://item.rakuten.co.jp/shop/bookcase/', shopName: '店舗' }, '本棚');
}
function results(product, height = 70) { return searchProducts([product], { ...conditions, height }); }

for (const name of ['本棚 幅60 高さ180', '本棚 幅59.8 奥行23 高さ180', '本棚 高さ180cm']) {
  test(`height 180 excludes at 70 but not at equality: ${name}`, () => {
    const product = item(name);
    assert.equal(product.dimensions, null);
    assert.equal(product.dimensionBounds.height.min, 180);
    assert.equal(results(product).length, 0);
    assert.equal(results(product, 180).length, 1);
    assert.equal(results(product, 180)[0].fit, false);
  });
}
test('unknown height remains size-needs-confirmation', () => {
  const product = item('本棚 幅60');
  assert.equal(product.dimensionBounds.height, undefined);
  assert.equal(results(product).length, 1);
  assert.equal(results(product)[0].fit, false);
});
for (const text of ['内寸 高さ180cm', '引き出し外寸 高さ180cm', '梱包サイズ 高さ180cm', '棚板サイズ 高さ180cm', '部品サイズ 高さ180cm']) {
  test(`component dimensions cannot exclude the body: ${text}`, () => {
    for (const product of [item(`本棚 ${text}`), item('本棚', text), item('本棚', '', text)]) {
      assert.equal(product.dimensionBounds.height, undefined);
      assert.equal(results(product).length, 1);
    }
  });
}
test('partial caption and catchcopy explicitly identify oversized body dimensions', () => {
  assert.equal(results(item('本棚', '本体サイズ：高さ180cm')).length, 0);
  assert.equal(results(item('本棚', '', '幅59.8 奥行23 高さ180cm')).length, 0);
  assert.equal(results(item('本棚', '商品サイズ：幅60 高さ180')).length, 0);
});
test('a known width or depth also excludes when other axes are missing', () => {
  assert.equal(results(item('本棚 幅61cm')).length, 0);
  assert.equal(results(item('本棚 奥行61cm')).length, 0);
});
test('width alternatives do not discard a clearly shared height 180', () => {
  const product = item('本棚 約 幅30cm/44cm/60cm/90cm 奥行き30 高さ180 全4色 組立品/完成品が選べる');
  assert.equal(product.dimensionBounds.width.min, 30);
  assert.equal(product.dimensionBounds.height.min, 180);
  assert.equal(results(product).length, 0);
});
test('some fitting size alternatives remain unknown; all oversized alternatives are excluded', () => {
  assert.equal(results(item('本棚 高さ60/180cm')).length, 1);
  assert.equal(results(item('本棚 高さ90/180cm')).length, 0);
  const low = item('本棚', '本体サイズ：幅60×奥行23×高さ60cm 本体サイズ：幅60×奥行23×高さ180cm');
  const high = item('本棚', '本体サイズ：幅60×奥行23×高さ90cm 本体サイズ：幅60×奥行23×高さ180cm');
  assert.equal(low.dimensions, null);
  assert.equal(results(low).length, 1);
  assert.equal(results(low)[0].fit, false);
  assert.equal(results(high).length, 0);
});
test('an alternative with missing height prevents claiming every height is oversized', () => {
  const product = item('本棚 幅50/60', '本体サイズ：幅60×高さ180cm 本体サイズ：幅50cm');
  assert.equal(product.dimensionBounds.height, undefined);
  assert.equal(results(product).length, 1);
});
test('all alternatives oversized on different axes are also excluded without mixing options', () => {
  const high = item('本棚 幅60/80', '本体サイズ：幅60×高さ180cm 本体サイズ：幅80cm');
  assert.equal(high.dimensionBounds.height, undefined);
  assert.equal(results(high).length, 0);
  const fitting = item('本棚 幅60/80', '本体サイズ：幅60×高さ60cm 本体サイズ：幅80×高さ180cm');
  assert.equal(results(fitting).length, 1);
  const latin = item('本棚', '本体サイズ：W80×D23×H60(cm) 本体サイズ：W60×D23×H180(cm)');
  assert.equal(latin.dimensions, null);
  assert.equal(results(latin).length, 0);
  const conflict = item('本棚 幅60 高さ50', '本体サイズ：幅80×奥行23×高さ60cm 本体サイズ：幅60×奥行23×高さ180cm');
  assert.equal(results(conflict).length, 1);
});
test('unlisted size choices and explicitly unknown alternative heights stay unknown', () => {
  for (const product of [item('本棚 高さ180cm 2サイズ'), item('本棚 高さ180cm/不明'), item('本棚', '本体サイズ：高さ180cm 本体サイズ：高さ不明')]) {
    assert.equal(product.dimensionBounds.height, undefined);
    assert.equal(results(product).length, 1);
  }
  assert.equal(results(item('本棚 幅30/60cm 高さ180cm 2サイズ')).length, 0);
});
test('a specifically identified type with all title axes is not an unspecified choice', () => {
  assert.equal(results(item('隙間収納 8サイズ展開 | Bタイプ 幅15cm 奥行60cm 高さ180cm | キッチンワゴン')).length, 0);
});
test('related-series size choices cannot erase the named bookcase height', () => {
  const product = item('本棚 完成品 フナモコ 幅75×高さ180cm CBS-75T', '関連商品一覧 8サイズ展開。別シリーズの収納家具もご覧ください。');
  assert.equal(product.dimensionBounds.height.min, 180);
  assert.equal(results(product).length, 0);
});
test('conflicting sources preserve all possible heights instead of choosing the largest', () => {
  const product = item('本棚 高さ180cm', '本体サイズ：高さ60cm');
  assert.deepEqual(product.dimensionBounds.height.values, [60, 180]);
  assert.equal(results(product).length, 1);
});
test('millimeters, shared units and lower bounds convert without estimating missing axes', () => {
  assert.equal(extractDimensionBounds('本棚 高さ1800mm', '').height.min, 180);
  assert.equal(extractDimensionBounds('本棚 高さ1800/2000mm', '').height.min, 180);
  assert.equal(results(item('本棚 高さ600〜1800mm')).length, 1);
  assert.equal(results(item('本棚 高さ1800〜2000mm')).length, 0);
});
test('compatibility statements and unsupported size alternatives remain unknown', () => {
  for (const name of ['本棚 高さ180cmまで対応', '本棚 高さ180cm以下', '本棚 高さ180cm、60cm', '本棚 高さ180cmまたは60cm']) assert.equal(results(item(name)).length, 1);
});
test('partial bounds reset to explicit body size after internal-size context', () => {
  const product = item('本棚', '内寸 高さ180cm 本体サイズ：高さ60cm');
  assert.equal(product.dimensionBounds.height.min, 60);
  assert.equal(results(product).length, 1);
});
test('invalid bound metadata cannot silently allow unsafe catalog rendering', () => {
  const data = { version: 1, status: 'ok', generatedAt: new Date().toISOString(), failedCategories: [], items: [item('本棚 高さ180cm')] };
  assert.equal(validateCatalog(data), data);
  for (const dimensionBounds of [{ height: { min: NaN } }, { height: { min: 60, values: [180], evidence: [{source:'商品名', text:'高さ180'}] } }, { length: { min: 180, values: [180], evidence: [{source:'商品名', text:'180'}] } }]) assert.throws(() => validateCatalog({ ...data, items: [{ ...data.items[0], dimensionBounds }] }), /INVALID_CATALOG/);
});
