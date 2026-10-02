export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export function isFresh(catalog, now = Date.now()) {
  const age = now - Date.parse(catalog.generatedAt);
  return Number.isFinite(age) && age >= -5 * 60 * 1000 && age < MAX_AGE_MS;
}

export function validConditions(conditions) {
  return ['width', 'depth', 'height', 'budget'].every(key => {
    const value = conditions[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= (key === 'budget' ? 999999999 : 1000);
  }) && Number.isInteger(conditions.budget);
}

export function searchProducts(items, conditions) {
  if (!validConditions(conditions)) throw new Error('INVALID_CONDITIONS');
  return items.filter(item => {
    const price = item.priceMax ?? item.price;
    return Number.isFinite(price) && price > 0 && price <= conditions.budget &&
      (!conditions.category || item.categories.includes(conditions.category)) &&
      (!item.dimensions || ['width', 'depth', 'height'].every(key => item.dimensions[key] <= conditions[key])) &&
      (conditions.includeUnknown || item.dimensions);
  }).map(item => ({ ...item, fit: Boolean(item.dimensions) })).sort((a, b) =>
    Number(b.fit) - Number(a.fit) ||
    (conditions.sort === 'price-desc' ? (b.priceMax ?? b.price) - (a.priceMax ?? a.price) : (a.priceMax ?? a.price) - (b.priceMax ?? b.price)) || a.id.localeCompare(b.id));
}

export function safeRakutenUrl(value, image = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
      !(image ? url.hostname === 'thumbnail.image.rakuten.co.jp' || url.hostname.endsWith('.rakuten.co.jp') : url.hostname === 'item.rakuten.co.jp')) return null;
    // API links can carry application tracking identifiers. Publish canonical item
    // URLs only; images retain just the documented size query, never tracking fields.
    const size = image ? url.searchParams.get('_ex') : null;
    url.search = '';
    url.hash = '';
    if (size && /^\d{1,4}x\d{1,4}$/.test(size)) url.searchParams.set('_ex', size);
    return url.href;
  } catch { return null; }
}

export function validateCatalog(data) {
  if (!data || data.version !== 1 || !['ok', 'partial', 'unavailable'].includes(data.status) ||
      !Number.isFinite(Date.parse(data.generatedAt)) || !Array.isArray(data.items) ||
      !Array.isArray(data.failedCategories)) throw new Error('INVALID_CATALOG');
  for (const item of data.items) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.shop !== 'string' ||
        !Number.isFinite(item.price) || item.price <= 0 || !Array.isArray(item.categories) ||
        !safeRakutenUrl(item.url) || (item.image && !safeRakutenUrl(item.image, true)) ||
        (item.priceMax != null && (!Number.isFinite(item.priceMax) || item.priceMax < item.price)) ||
        (item.dimensions && (!['width', 'depth', 'height'].every(key => typeof item.dimensions[key] === 'number' && item.dimensions[key] > 0 && item.dimensions[key] <= 1000) || typeof item.dimensions.evidence !== 'string'))) throw new Error('INVALID_CATALOG');
  }
  return data;
}
