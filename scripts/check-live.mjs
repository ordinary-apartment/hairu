// Read-only verification against the deployed public catalog, with no secret access.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { validateCatalog, isFresh, searchProducts } from '../lib.mjs';

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
    await page.locator('#budget').fill('1');
    await page.locator('#search-button').click();
    await page.locator('#empty-state').waitFor();
    assert.equal(await page.locator('.product-card').count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(apiRequests, []);
    console.log(`${name}: live catalog ${catalog.items.length} items; explicit dimensions ${catalog.items.filter(item => item.dimensions).length}; example matches ${expected.length}; search/evidence/zero results/layout verified.`);
    await page.close();
  }
} finally { await browser.close(); }
