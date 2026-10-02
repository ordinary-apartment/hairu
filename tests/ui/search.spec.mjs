import { test, expect } from '@playwright/test';
import { extractDimensionBounds } from '../../scripts/dimensions.mjs';

const dimensions = { width: 60, depth: 30, height: 100, source: '商品説明', evidence: '本体サイズ:幅60×奥行30×高さ100cm' };
const product = (id, price, dims, categories = ['本棚']) => ({ id, name: `収納家具 ${id}`, shop: 'テスト店舗', price, priceMax: null, url: `https://item.rakuten.co.jp/test/${id}/`, image: null, postageIncluded: false, categories, dimensions: dims, dimensionReason: dims ? null : '本体の幅・奥行・高さを確定できません' });
const catalog = overrides => ({ version: 1, status: 'ok', generatedAt: new Date().toISOString(), failedCategories: [], items: [product('fit-cheap', 5000, dimensions), product('fit-costly', 15000, dimensions), product('unknown', 1000, null, ['チェスト']), product('oversized', 2000, { ...dimensions, width: 100 })], ...overrides });
async function mockCatalog(page, data) {
  await page.route('**/data/catalog.json?*', route => route.fulfill({ json: data }));
}
async function search(page) {
  await page.getByRole('button', { name: '入力例を使う' }).click();
  await page.getByRole('button', { name: 'この条件で探す' }).click();
}

test('initial state and required fields prevent empty search', async ({ page }) => {
  await mockCatalog(page, catalog());
  await page.goto('/');
  await expect(page.locator('#initial-state')).toBeVisible();
  await page.getByRole('button', { name: 'この条件で探す' }).click();
  await expect(page.locator('.product-card')).toHaveCount(0);
  expect(await page.locator('#width').evaluate(node => node.validity.valueMissing)).toBe(true);
});

test('matching candidates precede unknowns; evidence and normal Rakuten links display', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockCatalog(page, catalog());
  await page.goto('/');
  await search(page);
  await expect(page.locator('.product-card')).toHaveCount(3);
  await expect(page.locator('.product-card').first()).toContainText('fit-cheap');
  await expect(page.locator('.product-card').last()).toContainText('サイズ要確認');
  await page.locator('.product-card').first().getByText('サイズの記載箇所').click();
  await expect(page.locator('.product-card').first()).toContainText(dimensions.evidence);
  await expect(page.locator('.product-link').first()).toHaveAttribute('href', 'https://item.rakuten.co.jp/test/fit-cheap/');
  await expect(page.locator('#results-count')).toContainText('3件の候補');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('results.png'), fullPage: true });
});

test('unknown toggle, price sort and furniture category work', async ({ page }) => {
  await mockCatalog(page, catalog());
  await page.goto('/');
  await search(page);
  await page.locator('#include-unknown').uncheck();
  await expect(page.locator('.product-card')).toHaveCount(2);
  await page.locator('#sort').selectOption('price-desc');
  await expect(page.locator('.product-card').first()).toContainText('fit-costly');
  await page.locator('#category').selectOption('チェスト');
  await page.getByRole('button', { name: 'この条件で探す' }).click();
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.locator('#include-unknown').check();
  await expect(page.locator('.product-card')).toHaveCount(1);
});

test('zero results and numeric validation display without breaking the page', async ({ page }) => {
  await mockCatalog(page, catalog());
  await page.goto('/');
  await page.getByRole('button', { name: '入力例を使う' }).click();
  await page.locator('#width').fill('-1');
  await page.getByRole('button', { name: 'この条件で探す' }).click();
  await expect(page.locator('.product-card')).toHaveCount(0);
  expect(await page.locator('#width').evaluate(node => node.validity.rangeUnderflow)).toBe(true);
  await page.locator('#width').fill('80');
  await page.locator('#budget').fill('1');
  await page.getByRole('button', { name: 'この条件で探す' }).click();
  await expect(page.locator('#empty-state')).toBeVisible();
});

test('network failure is retryable', async ({ page }) => {
  let failed = true;
  await page.route('**/data/catalog.json?*', route => failed ? route.abort() : route.fulfill({ json: catalog() }));
  await page.goto('/');
  await expect(page.locator('#error-title')).toContainText('読み込めませんでした');
  failed = false;
  await page.getByRole('button', { name: 'データを再読み込み' }).click();
  await expect(page.locator('#error-panel')).toBeHidden();
  await search(page);
  await expect(page.locator('.product-card')).toHaveCount(3);
});

test('API unavailable is distinct from successful zero results', async ({ page }) => {
  await mockCatalog(page, catalog({ status: 'unavailable', items: [] }));
  await page.goto('/');
  await expect(page.locator('#error-title')).toContainText('取得できませんでした');
  await expect(page.locator('#empty-state')).toBeHidden();
});

test('partial API failure shows warning and successful products', async ({ page }) => {
  await mockCatalog(page, catalog({ status: 'partial', failedCategories: [{ category: 'キャビネット', code: 'HTTP_503' }] }));
  await page.goto('/');
  await search(page);
  await expect(page.locator('#notice')).toContainText('キャビネット');
  await expect(page.locator('.product-card')).toHaveCount(3);
});

test('expired catalog never displays product prices', async ({ page }) => {
  await mockCatalog(page, catalog({ generatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }));
  await page.goto('/');
  await expect(page.locator('#error-title')).toContainText('更新を待っています');
  await search(page);
  await expect(page.locator('.product-card')).toHaveCount(0);
});

test('malformed catalog is a recoverable error; product text cannot execute HTML', async ({ page }) => {
  await mockCatalog(page, { broken: true });
  await page.goto('/');
  await expect(page.locator('#error-panel')).toBeVisible();
  await page.unroute('**/data/catalog.json?*');
  const data = catalog();
  data.items[0].name = '<img src=x onerror="window.injected=true">';
  await mockCatalog(page, data);
  await page.getByRole('button', { name: 'データを再読み込み' }).click();
  await search(page);
  await expect(page.locator('.product-title').first()).toContainText('<img src=x');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('pagination appends candidates without losing priority', async ({ page }) => {
  const items = Array.from({ length: 30 }, (_, index) => product(`item-${index}`, 1000 + index, dimensions));
  await mockCatalog(page, catalog({ items }));
  await page.goto('/');
  await search(page);
  await expect(page.locator('.product-card')).toHaveCount(24);
  await page.locator('#load-more').click();
  await expect(page.locator('.product-card')).toHaveCount(30);
  await expect(page.locator('#load-more')).toBeHidden();
});

test('height 70 excludes clear partial height 180, while unknown and internal height remain', async ({ page }) => {
  const high = { ...product('height180', 1000, null), name: '本棚 幅60 高さ180', dimensionBounds: extractDimensionBounds('本棚 幅60 高さ180', '') };
  const unknown = { ...product('heightUnknown', 1000, null), name: '本棚 幅60', dimensionBounds: extractDimensionBounds('本棚 幅60', '') };
  const inner = { ...product('inner180', 1000, null), name: '本棚 内寸 高さ180cm', dimensionBounds: extractDimensionBounds('本棚 内寸 高さ180cm', '') };
  await mockCatalog(page, catalog({ items: [high, unknown, inner] }));
  await page.goto('/');
  for (const [id, value] of Object.entries({ width: '60.3', depth: '60.2', height: '70', budget: '20000' })) await page.locator(`#${id}`).fill(value);
  await page.locator('#search-button').click();
  await expect(page.locator('.product-card')).toHaveCount(2);
  await expect(page.locator('#products')).not.toContainText('本棚 幅60 高さ180');
  await expect(page.locator('#products')).toContainText('内寸 高さ180cm');
  await page.locator('#height').fill('180');
  await page.locator('#search-button').click();
  await expect(page.locator('.product-card')).toHaveCount(3);
  await expect(page.locator('.fit-badge.unknown')).toHaveCount(3);
  const highCard = page.locator('.product-card').filter({ hasText: '本棚 幅60 高さ180' });
  await highCard.getByText('確認できた寸法の記載').click();
  await expect(highCard).toContainText('商品名：高さ180');
});
