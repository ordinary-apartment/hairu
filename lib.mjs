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
    return item.availability !== 0 && Number.isFinite(price) && price > 0 && price <= conditions.budget &&
      (!conditions.category || item.categories.includes(conditions.category)) &&
      (!item.dimensionBounds || Object.entries(item.dimensionBounds).every(([key, bound]) => bound.min <= conditions[key])) &&
      (!item.dimensionOptions?.length || !item.dimensionOptions.every(option => Object.entries(option).some(([key, value]) => value > conditions[key]))) &&
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
  const ids = new Set();
  for (const item of data.items) {
    if (ids.has(item?.id)) throw new Error('INVALID_CATALOG');
    ids.add(item?.id);
    for (const key of ['firstSeenAt', 'lastSeenAt', 'lastCheckedAt', 'lastUpdatedAt', 'priceChangedAt']) {
      if (item[key] != null && !Number.isFinite(Date.parse(item[key]))) throw new Error('INVALID_CATALOG');
    }
    if (item.availability != null && ![0, 1].includes(item.availability)) throw new Error('INVALID_CATALOG');
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.shop !== 'string' ||
        !Number.isFinite(item.price) || item.price <= 0 || !Array.isArray(item.categories) ||
        !safeRakutenUrl(item.url) || (item.image && !safeRakutenUrl(item.image, true)) ||
        (item.priceMax != null && (!Number.isFinite(item.priceMax) || item.priceMax < item.price)) ||
        (item.dimensions && (!['width', 'depth', 'height'].every(key => typeof item.dimensions[key] === 'number' && item.dimensions[key] > 0 && item.dimensions[key] <= 1000) || typeof item.dimensions.evidence !== 'string'))) throw new Error('INVALID_CATALOG');
    if (item.dimensionBounds != null && (typeof item.dimensionBounds !== 'object' || Array.isArray(item.dimensionBounds) ||
      Object.entries(item.dimensionBounds).some(([key, bound]) => !['width', 'depth', 'height'].includes(key) || !bound ||
        !Number.isFinite(bound.min) || bound.min <= 0 || bound.min > 100000 || !Array.isArray(bound.values) || !bound.values.length ||
        bound.values.some(value => !Number.isFinite(value) || value <= 0 || value > 100000) || Math.min(...bound.values) !== bound.min ||
        !Array.isArray(bound.evidence) || !bound.evidence.length || bound.evidence.some(evidence => typeof evidence?.source !== 'string' || typeof evidence?.text !== 'string')))) throw new Error('INVALID_CATALOG');
    if (item.dimensionOptions != null && (!Array.isArray(item.dimensionOptions) || item.dimensionOptions.some(option => !option || typeof option !== 'object' || Array.isArray(option) ||
      Object.entries(option).some(([key, value]) => !['width', 'depth', 'height'].includes(key) || !Number.isFinite(value) || value <= 0 || value > 100000)))) throw new Error('INVALID_CATALOG');
  }
  return data;
}
