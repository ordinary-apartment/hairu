import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { ensureNoSecrets, CATEGORIES, ApiFailure } from './fetch-catalog.mjs';

import { validateCatalog } from '../lib.mjs';

const offline = process.argv.includes('--offline');
const catalogIndex = process.argv.indexOf('--catalog');
const catalogPath = catalogIndex >= 0 ? process.argv[catalogIndex + 1] : 'state/catalog.json';
const appId = process.env.RAKUTEN_APP_ID;
const accessKey = process.env.RAKUTEN_ACCESS_KEY;
let stage = 'read-catalog';
try {
  const catalog = offline ? {
    version: 1, generatedAt: new Date().toISOString(), status: 'unavailable', source: 'offline', categories: CATEGORIES, failedCategories: [], items: [],
  } : validateCatalog(JSON.parse(await readFile(catalogPath, 'utf8')));
  if (!offline && (catalog.status !== 'ok' || !catalog.items.length)) throw new ApiFailure('INVALID_CATALOG');
  const serialized = JSON.stringify(catalog);
  stage = 'catalog-output';
  ensureNoSecrets(serialized, [appId, accessKey]);
  await mkdir('dist/data', { recursive: true });
  // Whitelist public assets: no repository, scripts, environment or source API payloads.
  for (const file of ['index.html', 'styles.css', 'app.mjs', 'lib.mjs', 'favicon.svg']) {
    stage = `asset-${file}`;
    ensureNoSecrets(await readFile(file, 'utf8'), [appId, accessKey]);
    await copyFile(file, `dist/${file}`);
  }
  await writeFile('dist/.nojekyll', '');
  await writeFile('dist/data/catalog.json', serialized);
  console.log(`Catalog: ${catalog.status}; ${catalog.items.length} items; ${catalog.items.filter(item => item.dimensions).length} with explicit body dimensions.`);
  for (const failure of catalog.failedCategories) console.log(`Category ${failure.category}: ${failure.code}`);
} catch (error) {
  const allowedCodes = ['SECRET_IN_OUTPUT', 'INVALID_CATALOG'];
  const code = (error instanceof ApiFailure && allowedCodes.includes(error.code)) ? error.code : error instanceof TypeError ? 'TYPE_ERROR' : error instanceof SyntaxError ? 'SYNTAX_ERROR' : 'BUILD_ERROR';
  const location = String(error.stack ?? '').match(/(?:build|dimensions|fetch-catalog|lib)\.mjs:\d+:\d+/)?.[0] ?? 'unknown';
  console.error(`Build failed safely: ${code} at ${stage} (${location}). No credentials or request details were logged.`);
  process.exitCode = 1;
}
