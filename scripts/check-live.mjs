// Read-only verification against the deployed public catalog, with no secret access.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { validateCatalog, isFresh, searchProducts } from '../lib.mjs';
import { extractDimensionBounds } from './dimensions.mjs';

const baseURL = process.env.HAIRU_LIVE_URL || 'https://ordinary-apartment.github.io/hairu/';
const browser = await chromium.launch({ channel: process.platform === 'darwin' ? 'chrome' : undefined });
try {
  await mkdir('test-results', { recursive: true });
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: name === 'mobile', hasTouch: name === 'mobile' });
    const errors = [];
    const apiRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).hostname === 'openapi.rakuten.co.jp') apiRequests.push(request.url()); });
    const dataResponse = await page.request.get(`${baseURL}data/catalog.json?t=${Date.now()}`);
    assert.equal(dataResponse.status(), 200);
    const catalog = validateCatalog(await dataResponse.json());
    assert.ok(isFresh(catalog));
    assert.equal(catalog.status, 'ok');
    assert.ok(catalog.items.length > 0);
    assert.ok(catalog.items.some(item => item.dimensions));
    await page.goto(baseURL);
    await page.locator('#catalog-meta').filter({ hasText: '件の候補' }).waitFor();
    await page.screenshot({ path: `test-results/live-${name}-initial.png`, fullPage: true });
    await page.locator('#example-button').click();
    await page.locator('#search-button').click();
    const expected = searchProducts(catalog.items, { width: 80, depth: 40, height: 120, budget: 20000, includeUnknown: true, sort: 'price-asc', category: '' });
    assert.ok(expected.some(item => item.fit));
    await page.locator('.product-card').first().waitFor();
    assert.equal(await page.locator('.product-card').count(), Math.min(24, expected.length));
    assert.ok((await page.locator('.product-card').first().textContent()).includes(expected[0].name));
    await page.locator('.product-card').first().locator('summary').click();
    assert.ok((await page.locator('.product-card').first().textContent()).includes(expected[0].dimensions.evidence));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `test-results/live-${name}-results.png`, fullPage: true });
    await page.locator('#include-unknown').uncheck();
    assert.ok(!(await page.locator('#products').textContent()).includes('サイズ要確認'));
    // Regression: incomplete but clearly high bookcases must not remain in the
    // unknown group. Check every page, not just the first 24 displayed products.
    const lowConditions = { width: 60.3, depth: 60.2, height: 70, budget: 999999999, includeUnknown: true, sort: 'price-asc', category: '' };
    assert.ok(catalog.items.every(item => item.dimensionBounds != null));
    const legacy = searchProducts(catalog.items.map(({ dimensionBounds, dimensionOptions, ...item }) => item), lowConditions);
    const clear180 = legacy.filter(item => !item.dimensions && extractDimensionBounds(item.name, '', item.catchcopy).height?.min === 180 &&
      !catalog.items.find(raw => raw.id === item.id)?.dimensionBounds.height?.values.some(value => value <= 70));
    assert.ok(clear180.length > 0, 'Live catalog must contain a real formerly-unknown height180 regression case.');
    for (const key of ['width', 'depth', 'height', 'budget']) await page.locator(`#${key}`).fill(String(lowConditions[key]));
    await page.locator('#include-unknown').check();
    await page.locator('#search-button').click();
    const lowMatches = searchProducts(catalog.items, lowConditions);
    assert.ok(clear180.every(high => !lowMatches.some(item => item.id === high.id)));
    assert.ok(lowMatches.every(item => !item.dimensionBounds.height || item.dimensionBounds.height.min <= 70));
    while (await page.locator('#load-more').isVisible()) await page.locator('#load-more').click();
    assert.equal(await page.locator('.product-card').count(), lowMatches.length);
    const renderedLinks = await page.locator('.product-link').evaluateAll(links => links.map(link => link.href));
    for (const high of clear180) assert.ok(!renderedLinks.includes(high.url));
    await page.screenshot({ path: `test-results/live-${name}-height70.png`, fullPage: true });
    await page.locator('#budget').fill('1');
    await page.locator('#search-button').click();
    await page.locator('#empty-state').waitFor();
    assert.equal(await page.locator('.product-card').count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(apiRequests, []);
    console.log(`${name}: live catalog ${catalog.items.length} items; height70 matches ${lowMatches.length}; formerly-unknown clear height180 excluded ${clear180.length}; all result pages/search/evidence/zero results/layout verified.`);
    await page.close();
  }
} finally { await browser.close(); }
