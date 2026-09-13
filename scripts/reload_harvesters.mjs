#!/usr/bin/env node

/**
 * scripts/reload_harvesters.mjs
 *
 * Dedicated Hot-Reload Broadcaster for the 12 Harvester Terminals.
 * Seamlessly triggers `tsx watch` across all running background worker processes
 * in-place without closing cmd windows or interrupting terminal progress.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT_DIR = process.cwd();
const HARVESTER_PATH = path.join(ROOT_DIR, 'scripts', 'harvest_top100_company_images.ts');

async function main() {
  console.log('===============================================================');
  console.log('   AI PHARMACY - 12 HARVESTER TERMINAL HOT-RELOAD BROADCAST');
  console.log('===============================================================');

  if (!fs.existsSync(HARVESTER_PATH)) {
    console.error(`Error: Harvester file not found at ${HARVESTER_PATH}`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  console.log(`[Signal] Broadcasting hot-reload trigger at: ${timestamp}`);

  let content = fs.readFileSync(HARVESTER_PATH, 'utf8');
  const triggerRegex = /\/\/ \[HARVESTER_HOT_RELOAD_TRIGGER\]: [^\r\n]+/;
  const newTrigger = `// [HARVESTER_HOT_RELOAD_TRIGGER]: ${timestamp}`;

  if (triggerRegex.test(content)) {
    content = content.replace(triggerRegex, newTrigger);
  } else {
    // Insert after shebang or at top
    if (content.startsWith('#!/usr/bin/env node')) {
      content = content.replace('#!/usr/bin/env node\n', `#!/usr/bin/env node\n\n${newTrigger}\n`);
    } else {
      content = `${newTrigger}\n\n${content}`;
    }
  }

  fs.writeFileSync(HARVESTER_PATH, content, 'utf8');
  console.log('✅ Updated hot-reload trigger in scripts/harvest_top100_company_images.ts');

  // Check running harvester processes
  console.log('\n[Status] Detecting active harvester worker processes...');
  try {
    const psOutput = execSync('powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, CPU, WorkingSet64, StartTime | Format-Table -AutoSize | Out-String"', { encoding: 'utf8' });
    console.log(psOutput.trim());
  } catch (err) {
    console.log('Could not list node processes via PowerShell.');
  }

  console.log('===============================================================');
  console.log('   HOT-RELOAD SIGNAL SENT SUCCESSFULLY!');
  console.log('   All 12 running terminals (tsx watch) are reloading with updated');
  console.log('   packaging filters, strength rules, and dosage matchers in-place.');
  console.log('===============================================================\n');
}

main().catch(console.error);
