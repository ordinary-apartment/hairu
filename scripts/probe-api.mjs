// Runs only in Actions. Never log credentials, URLs, or raw API errors.
import { writeFile } from 'node:fs/promises';
const appId = process.env.RAKUTEN_APP_ID;
const accessKey = process.env.RAKUTEN_ACCESS_KEY;
if (!appId || !accessKey) { console.error('Required repository secrets are missing.'); process.exit(1); }
try {
  const url = new URL('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701');
  url.search = new URLSearchParams({ applicationId: appId, genreId: '200166', keyword: 'キャビネット', hits: '3', attributeFlag: '1', formatVersion: '2' });
  const response = await fetch(url, { headers: { accessKey, Referer: 'https://ordinary-apartment.github.io/hairu/', Origin: 'https://ordinary-apartment.github.io' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) { console.error(`Rakuten API HTTP ${response.status}`); process.exit(1); }
  const body = await response.json();
  const items = body.Items ?? body.items;
  if (!Array.isArray(items)) throw new Error();
  const report = { responseFields: Object.keys(body), itemFields: Object.keys(items[0] ?? {}), attributes: body.Attributes ?? body.attributes, samples: items.map(item => ({ itemName: item.itemName, itemCaption: item.itemCaption })) };
  let serialized = JSON.stringify(report, null, 2);
  for (const secret of [appId, accessKey]) serialized = serialized.replaceAll(secret, '[redacted]');
  await writeFile('api-observation.json', serialized);
  console.log(`API connection verified: ${items.length} items. Credential-free schema observation saved.`);
} catch { console.error('API connection or response validation failed.'); process.exit(1); }
