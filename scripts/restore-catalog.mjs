import { mkdir, writeFile, rename } from 'node:fs/promises';
import { validateCatalog } from '../lib.mjs';

// Published Pages catalog is durable state, not an expiring Actions artifact.
// Failure to read the last good state aborts deployment; never substitute empties.
try {
  const response = await fetch(`https://ordinary-apartment.github.io/hairu/data/catalog.json?t=${Date.now()}`, { signal: AbortSignal.timeout(30000), redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error('RESTORE_FAILED');
  const catalog = validateCatalog(await response.json());
  if (catalog.status !== 'ok' || !catalog.items.length) throw new Error('INVALID_BASE');
  await mkdir('state', { recursive: true });
  await writeFile('state/catalog.json.tmp', JSON.stringify(catalog));
  await rename('state/catalog.json.tmp', 'state/catalog.json');
  console.log(`Restored last published catalog: ${catalog.items.length} items.`);
} catch {
  console.error('Could not restore a complete catalog. Existing deployment retained.');
  process.exitCode = 1;
}
