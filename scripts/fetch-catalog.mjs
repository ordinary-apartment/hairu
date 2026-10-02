import { extractDimensions, extractDimensionEvidence, plainText } from './dimensions.mjs';
import { safeRakutenUrl, validateCatalog } from '../lib.mjs';

export const ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
export const CATEGORIES = ['カラーボックス', '本棚', 'キャビネット', 'チェスト', '収納ラック', '隙間収納', 'シューズラック', 'キッチン収納'];
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Errors deliberately contain no request URL, response body or credentials.
export class ApiFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

export async function requestItems({ appId, accessKey, keyword, page, fetchImpl = fetch, sleep = delay }) {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ applicationId: appId, genreId: '200166', keyword, page: String(page), hits: '30', availability: '1', imageFlag: '1', formatVersion: '2', sort: 'standard' });
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accessKey, Referer: 'https://ordinary-apartment.github.io/hairu/', Origin: 'https://ordinary-apartment.github.io' },
        signal: AbortSignal.timeout(30000), redirect: 'error',
      });
    } catch {
      if (attempt < 2) { await sleep(2000 * 2 ** attempt); continue; }
      throw new ApiFailure('NETWORK');
    }
    if (response.status === 404) return { items: [], pageCount: 0 };
    if (response.status === 429 || response.status >= 500) {
      if (attempt < 2) { await sleep(2000 * 2 ** attempt); continue; }
      throw new ApiFailure(`HTTP_${response.status}`);
    }
    if (!response.ok) throw new ApiFailure(`HTTP_${response.status}`);
    let body;
    try { body = await response.json(); } catch { throw new ApiFailure('INVALID_JSON'); }
    const items = body.Items ?? body.items;
    if (body.error || !Array.isArray(items) || !Number.isFinite(body.pageCount)) throw new ApiFailure('INVALID_RESPONSE');
    return { items: items.map(item => item.Item ?? item.item ?? item), pageCount: body.pageCount };
  }
}

export function normalizeItem(raw, category) {
  const name = plainText(raw.itemName);
  const url = safeRakutenUrl(raw.itemUrl);
  const rawImage = raw.mediumImageUrls?.[0];
  const image = safeRakutenUrl(typeof rawImage === 'string' ? rawImage : rawImage?.imageUrl, true);
  const price = Number(raw.itemPrice);
  // Only available tax-inclusive products; exclude clearly labelled accessories.
  if (!name || !raw.itemCode || !url || !Number.isFinite(price) || price <= 0 || Number(raw.availability) !== 1 || Number(raw.taxFlag) !== 0 ||
      /交換用|専用(?:天板|棚板|キャスター)|(?:部品|パーツ)(?:のみ|単品)|追加棚板/.test(name)) return null;
  const priceMax = Number(raw.itemPriceMax3);
  return {
    id: String(raw.itemCode), name, catchcopy: plainText(raw.catchcopy), price,
    priceMax: Number.isFinite(priceMax) && priceMax > price ? priceMax : null,
    url, image, shop: plainText(raw.shopName), postageIncluded: Number(raw.postageFlag) === 0,
    categories: [category], ...extractDimensions(name, raw.itemCaption),
    ...extractDimensionEvidence(name, raw.itemCaption, raw.catchcopy),
  };
}

export async function fetchCatalog({ appId, accessKey, request = requestItems, sleep = delay, categories = CATEGORIES, pages = 3, now = () => new Date() }) {
  const catalog = { version: 1, generatedAt: now().toISOString(), status: 'ok', source: 'Rakuten Ichiba Item Search 20260701', categories, failedCategories: [], items: [] };
  if (!appId || !accessKey) return { ...catalog, status: 'unavailable', failedCategories: categories.map(category => ({ category, code: 'MISSING_SECRETS' })) };
  const byId = new Map();
  for (const category of categories) {
    for (let page = 1; page <= pages; page++) {
      let result;
      try { result = await request({ appId, accessKey, keyword: category, page }); }
      catch (error) {
        catalog.failedCategories.push({ category, code: error instanceof ApiFailure ? error.code : 'REQUEST_FAILED' });
        break;
      }
      for (const raw of result.items) {
        const item = normalizeItem(raw, category);
        if (!item) continue;
        if (byId.has(item.id)) {
          const existing = byId.get(item.id);
          if (!existing.categories.includes(category)) existing.categories.push(category);
        } else byId.set(item.id, item);
      }
      await sleep(1200); // Sequential requests, at most one request per second.
      if (page >= result.pageCount) break;
    }
  }
  catalog.items = [...byId.values()];
  catalog.status = catalog.failedCategories.length ? (catalog.items.length ? 'partial' : 'unavailable') : 'ok';
  validateCatalog(catalog);
  return catalog;
}

export function ensureNoSecrets(text, secrets) {
  for (const secret of secrets.filter(Boolean)) {
    if ([secret, encodeURIComponent(secret)].some(value => text.includes(value))) throw new ApiFailure('SECRET_IN_OUTPUT');
  }
}
