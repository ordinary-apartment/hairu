import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { fetchCatalog, ensureNoSecrets, CATEGORIES } from './fetch-catalog.mjs';

const offline = process.argv.includes('--offline');
const appId = process.env.RAKUTEN_APP_ID;
const accessKey = process.env.RAKUTEN_ACCESS_KEY;
try {
  const catalog = offline ? {
    version: 1, generatedAt: new Date().toISOString(), status: 'unavailable', source: 'offline', categories: CATEGORIES, failedCategories: [], items: [],
  } : await fetchCatalog({ appId, accessKey });
  const serialized = JSON.stringify(catalog);
  ensureNoSecrets(serialized, [appId, accessKey]);
  await mkdir('dist/data', { recursive: true });
  // Whitelist public assets: no repository, scripts, environment or source API payloads.
  for (const file of ['index.html', 'styles.css', 'app.mjs', 'lib.mjs', 'favicon.svg']) {
    ensureNoSecrets(await readFile(file, 'utf8'), [appId, accessKey]);
    await copyFile(file, `dist/${file}`);
  }
  await writeFile('dist/.nojekyll', '');
  await writeFile('dist/data/catalog.json', serialized);
  console.log(`Catalog: ${catalog.status}; ${catalog.items.length} items; ${catalog.items.filter(item => item.dimensions).length} with explicit body dimensions.`);
  for (const failure of catalog.failedCategories) console.log(`Category ${failure.category}: ${failure.code}`);
  if (catalog.status !== 'ok' && !offline) console.log('::warning::Rakuten catalog update incomplete; the public UI will display the availability status.');
} catch {
  console.error('Build failed safely. No credentials or request details were logged.');
  process.exitCode = 1;
}
