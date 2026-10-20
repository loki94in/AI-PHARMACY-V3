import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const routesDir = path.resolve(__dirname, '../src/routes');

async function verifyRoutes() {
  console.log('--- Route Integrity Self-Test ---');
  console.log(`Scanning routes directory: ${routesDir}`);

  const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  console.log(`Found ${files.length} route modules to verify.\n`);

  let passed = 0;
  let failed = 0;
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    const fullPath = path.join(routesDir, file);
    const fileUrl = pathToFileURL(fullPath).href;
    const t0 = performance.now();

    try {
      const module = await import(fileUrl);
      const router = module.default || module.router;
      if (!router) {
        throw new Error('Module has neither a default export nor a "router" export.');
      }
      const elapsed = Math.round(performance.now() - t0);
      console.log(`  ✓ ${file.padEnd(30)} [${elapsed}ms]`);
      passed++;
    } catch (err: any) {
      const elapsed = Math.round(performance.now() - t0);
      console.error(`  ✗ ${file.padEnd(30)} [${elapsed}ms] FAILED: ${err?.message || err}`);
      failed++;
      errors.push({ file, error: err?.stack || err?.message || String(err) });
    }
  }

  console.log('\n--- Route Verification Summary ---');
  console.log(`Total: ${files.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.error('\nFailures detected:');
    for (const e of errors) {
      console.error(`\n[${e.file}]:\n${e.error}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll route modules resolved and loaded cleanly with zero initialization errors.');
    process.exit(0);
  }
}

verifyRoutes().catch(err => {
  console.error('Fatal runner error during route verification:', err);
  process.exit(1);
});
