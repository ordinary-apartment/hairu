import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchCatalog, normalizeItem, requestItems, delay, ensureNoSecrets, ApiFailure } from './fetch-catalog.mjs';
import { validateCatalog } from '../lib.mjs';

// Parser changes automatically invalidate cached analyses on the next API update.
export const parserVersion = createHash('sha256').update(await readFile(new URL('./dimensions.mjs', import.meta.url))).digest('hex');
export function sourceFingerprint(raw) {
  return createHash('sha256').update(JSON.stringify([raw.itemName ?? '', raw.catchcopy ?? '', raw.itemCaption ?? ''])).digest('hex');
}
export function refreshItem(raw, category, previous, at, allowUnavailable = false) {
  if (!raw || typeof raw.itemCaption !== 'string') throw new ApiFailure('INCOMPLETE_ITEM');
  const fingerprint = sourceFingerprint(raw);
  const reused = previous?.dimensionSourceHash === fingerprint && previous?.dimensionParserVersion === parserVersion;
  const analysis = reused ? Object.fromEntries(['dimensions', 'dimensionReason', 'dimensionBounds', 'dimensionOptions'].map(key => [key, previous[key]])) : null;
  const item = normalizeItem(raw, category, { allowUnavailable, analysis });
  if (!item) return null;
  const priceChanged = previous && (previous.price !== item.price || previous.priceMax !== item.priceMax);
  return { ...item, categories: [...new Set([...(previous?.categories ?? []), category].filter(Boolean))],
    firstSeenAt: previous?.firstSeenAt ?? at, lastSeenAt: at, lastCheckedAt: at, lastUpdatedAt: at,
    dimensionSourceHash: fingerprint, dimensionParserVersion: parserVersion,
    previousPrice: priceChanged ? previous.price : previous?.previousPrice ?? null,
    priceChangedAt: priceChanged ? at : previous?.priceChangedAt ?? null,
    missingChecks: 0, saleEndCandidate: false };
}

// Transaction: any failed search, invalid item lookup or missing credentials aborts
// the whole update. The caller only writes/publishes the validated complete result.
export async function updateCatalog(previous, { appId, accessKey, mode = 'discovery', request = requestItems, sleep = delay, now = () => new Date(), categories, pages } = {}) {
  validateCatalog(previous);
  if (previous.status !== 'ok' || !previous.items.length) throw new ApiFailure('INVALID_BASE');
  if (!appId || !accessKey) throw new ApiFailure('MISSING_SECRETS');
  if (!['discovery', 'prices'].includes(mode)) throw new ApiFailure('INVALID_MODE');
  const at = now().toISOString();
  const base = new Map(previous.items.map(item => [item.id, { ...item, categories: [...item.categories], firstSeenAt: item.firstSeenAt ?? previous.generatedAt, lastSeenAt: item.lastSeenAt ?? previous.generatedAt, lastUpdatedAt: item.lastUpdatedAt ?? previous.generatedAt }]));
  const next = new Map(base);
  let requests = 0;
  const countedRequest = async options => { requests++; return request(options); };
  const seen = new Set();
  if (mode === 'discovery') {
    const discovered = await fetchCatalog({ appId, accessKey, request: countedRequest, sleep, categories, pages, now,
      normalize: (raw, category) => refreshItem(raw, category, base.get(String(raw.itemCode)), at) });
    if (discovered.status !== 'ok' || !discovered.items.length) throw new ApiFailure('INCOMPLETE_DISCOVERY');
    for (const item of discovered.items) { next.set(item.id, item); seen.add(item.id); }
  }
  // A limited keyword snapshot cannot prove disappearance or update every saved
  // product. Exact itemCode queries include unavailable products (availability=0).
  let checked = 0;
  let missing = 0;
  for (const [id, old] of base) {
    if (seen.has(id)) continue;
    const result = await countedRequest({ appId, accessKey, itemCode: id });
    checked++;
    if (!Array.isArray(result.items) || result.items.length > 1) throw new ApiFailure('INVALID_LOOKUP');
    if (!result.items.length) {
      missing++;
      const missingChecks = (old.missingChecks ?? 0) + 1;
      next.set(id, { ...old, lastCheckedAt: at, missingChecks, saleEndCandidate: missingChecks >= 2 });
    } else {
      if (String(result.items[0].itemCode) !== id) throw new ApiFailure('WRONG_ITEM');
      const item = refreshItem(result.items[0], old.categories[0], old, at, true);
      if (!item) throw new ApiFailure('INVALID_ITEM');
      next.set(id, item);
      seen.add(id);
    }
    await sleep(1200);
  }
  // Never interpret a globally empty response as every product disappearing.
  if (checked && missing === checked && !seen.size) throw new ApiFailure('EMPTY_UPDATE');
  const catalog = { ...previous, generatedAt: at, status: 'ok', failedCategories: [], items: [...next.values()],
    lastDiscoveryAt: mode === 'discovery' ? at : previous.lastDiscoveryAt ?? null,
    lastPriceUpdateAt: at, update: { mode, requests, seen: seen.size, missing, added: [...next.keys()].filter(id => !base.has(id)).length } };
  return validateCatalog(catalog);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const [basePath, outputPath, mode = 'discovery'] = process.argv.slice(2);
    if (!basePath || !outputPath) throw new ApiFailure('MISSING_PATH');
    const catalog = await updateCatalog(JSON.parse(await readFile(basePath, 'utf8')), {
      appId: process.env.RAKUTEN_APP_ID, accessKey: process.env.RAKUTEN_ACCESS_KEY, mode });
    const json = JSON.stringify(catalog);
    ensureNoSecrets(json, [process.env.RAKUTEN_APP_ID, process.env.RAKUTEN_ACCESS_KEY]);
    await mkdir('state', { recursive: true });
    await writeFile(`${outputPath}.tmp`, json);
    await rename(`${outputPath}.tmp`, outputPath);
    console.log(`Catalog updated: ${catalog.items.length} items; ${catalog.update.requests} API requests; ${catalog.update.added} additions; ${catalog.update.missing} missing confirmations.`);
  } catch (error) {
    console.error(`Catalog update aborted: ${error instanceof ApiFailure ? error.code : 'UPDATE_FAILED'}. Previous catalog and deployment retained.`);
    process.exitCode = 1;
  }
}
