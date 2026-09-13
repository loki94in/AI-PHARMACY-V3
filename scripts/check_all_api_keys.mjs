import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';

dotenv.config();

const ROOT_DIR = process.cwd();

async function main() {
  console.log('\n===============================================================');
  console.log('🔍 PHARMACY CATALOG AI VISION — API KEY AUDIT & STATUS CHECK');
  console.log('===============================================================\n');

  const keyMap = new Map();

  function registerKey(rawKey, source) {
    if (!rawKey) return;
    const cleanKey = String(rawKey).trim();
    if (!cleanKey || cleanKey.length < 15) return;

    if (!keyMap.has(cleanKey)) {
      keyMap.set(cleanKey, { key: cleanKey, sources: [source] });
    } else {
      const entry = keyMap.get(cleanKey);
      if (!entry.sources.includes(source)) {
        entry.sources.push(source);
      }
    }
  }

  function registerKeyList(str, source) {
    if (!str) return;
    const parts = String(str).split(/[,;\s]+/).map(k => k.trim()).filter(Boolean);
    parts.forEach((k, idx) => registerKey(k, `${source}[#${idx + 1}]`));
  }

  // 1. Check .env variables
  registerKey(process.env.GEMINI_API_KEY, '.env:GEMINI_API_KEY');
  registerKeyList(process.env.GEMINI_API_KEYS, '.env:GEMINI_API_KEYS');
  
  for (let pool = 1; pool <= 5; pool++) {
    registerKeyList(process.env[`GEMINI_API_KEYS_POOL_${pool}`], `.env:POOL_${pool}`);
    registerKey(process.env[`GEMINI_SPARE_KEY_POOL_${pool}`], `.env:SPARE_POOL_${pool}`);
  }

  // 2. Check data/working_gemini_keys.json
  const workingJsonPath = path.join(ROOT_DIR, 'data', 'working_gemini_keys.json');
  if (fs.existsSync(workingJsonPath)) {
    try {
      const jsonKeys = JSON.parse(fs.readFileSync(workingJsonPath, 'utf8'));
      jsonKeys.forEach((k, idx) => registerKey(k, `working_gemini_keys.json[#${idx + 1}]`));
    } catch (e) {
      console.warn(`[Warning] Could not parse working_gemini_keys.json:`, e.message);
    }
  }

  // 3. Check SQLite app.db app_settings table
  const dbPath = path.join(ROOT_DIR, 'data', 'app.db');
  if (fs.existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare("SELECT key, value FROM app_settings WHERE key LIKE '%gemini%' OR key LIKE '%api_key%'").all();
      for (const row of rows) {
        if (row.value && String(row.value).trim().length > 15) {
          registerKey(String(row.value).trim(), `SQLite:${row.key}`);
        }
      }
      db.close();
    } catch (e) {
      console.warn(`[Warning] Could not read app.db:`, e.message);
    }
  }

  const allKeys = Array.from(keyMap.values());
  console.log(`📦 Discovered ${allKeys.length} unique Gemini API keys across config, DB, and pools.`);
  console.log(`⚡ Testing live connection against Google Gemini API in parallel...\n`);

  // Test keys with concurrency
  const results = [];
  const concurrency = 5;
  for (let i = 0; i < allKeys.length; i += concurrency) {
    const chunk = allKeys.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (entry) => {
      const start = Date.now();
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${entry.key}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'AIPHarmacy-KeyChecker/1.0' } });
        entry.latencyMs = Date.now() - start;
        entry.statusCode = res.status;

        if (res.ok) {
          const data = await res.json();
          entry.status = 'working';
          entry.modelsCount = data.models ? data.models.length : 0;
          entry.message = `${entry.modelsCount} models ready`;
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || res.statusText || 'HTTP ' + res.status;
          if (res.status === 429) {
            entry.status = 'quota_exceeded';
            entry.message = 'Quota / Rate-limit reached';
          } else if (res.status === 400 || res.status === 403) {
            entry.status = 'invalid';
            entry.message = errMsg.includes('API key not valid') ? 'API key expired/invalid' : errMsg;
          } else {
            entry.status = 'error';
            entry.message = `HTTP ${res.status}: ${errMsg.substring(0, 40)}`;
          }
        }
      } catch (err) {
        entry.latencyMs = Date.now() - start;
        entry.status = 'error';
        entry.statusCode = 0;
        entry.message = err.message || 'Network timeout';
      }
      results.push(entry);
    }));
  }

  // Sort: working first, then quota, then invalid
  results.sort((a, b) => {
    const score = (s) => s === 'working' ? 1 : s === 'quota_exceeded' ? 2 : 3;
    return score(a.status) - score(b.status);
  });

  // Print Terminal Table
  console.log('┌─────┬──────────────────────────┬─────────────────────────────┬──────────┬───────────┬───────────────────────────────┐');
  console.log('│ #   │ MASKED API KEY           │ SOURCES                     │ STATUS   │ LATENCY   │ DETAILS                       │');
  console.log('├─────┼──────────────────────────┼─────────────────────────────┼──────────┼───────────┼───────────────────────────────┤');

  let workingCount = 0;
  let quotaCount = 0;
  let invalidCount = 0;
  let errorCount = 0;

  results.forEach((r, idx) => {
    const num = String(idx + 1).padEnd(3);
    const prefix = r.key.substring(0, 10);
    const suffix = r.key.substring(r.key.length - 6);
    const masked = `${prefix}...${suffix}`.padEnd(24);
    
    // Shorten sources summary
    let srcSummary = r.sources[0];
    if (r.sources.length > 1) {
      srcSummary += ` (+${r.sources.length - 1} more)`;
    }
    const src = srcSummary.substring(0, 27).padEnd(27);

    let statusStr = '';
    if (r.status === 'working') {
      statusStr = '✅ ACTIVE ';
      workingCount++;
    } else if (r.status === 'quota_exceeded') {
      statusStr = '⚠️ QUOTA  ';
      quotaCount++;
    } else if (r.status === 'invalid') {
      statusStr = '❌ INVALID';
      invalidCount++;
    } else {
      statusStr = '❓ ERROR  ';
      errorCount++;
    }

    const latency = (r.latencyMs ? `${r.latencyMs}ms` : '-').padEnd(9);
    const details = (r.message || '-').substring(0, 29).padEnd(29);

    console.log(`│ ${num} │ ${masked} │ ${src} │ ${statusStr} │ ${latency} │ ${details} │`);
  });
  console.log('└─────┴──────────────────────────┴─────────────────────────────┴──────────┴───────────┴───────────────────────────────┘');

  console.log('\n📊 KEY POOL AUDIT SUMMARY:');
  console.log(`   • Total Unique Keys Found   : ${results.length}`);
  console.log(`   • ✅ Currently Working/Active: ${workingCount} (${Math.round((workingCount / (results.length || 1)) * 100)}%)`);
  if (quotaCount > 0) console.log(`   • ⚠️ Quota Exhausted (429)  : ${quotaCount}`);
  if (invalidCount > 0) console.log(`   • ❌ Invalid / Expired      : ${invalidCount}`);
  if (errorCount > 0) console.log(`   • ❓ Network / Other Error  : ${errorCount}`);

  // Check if working keys match data/working_gemini_keys.json
  const activeKeys = results.filter(r => r.status === 'working').map(r => r.key);
  console.log(`\n📁 PERSISTENCE STATUS:`);
  console.log(`   • data/working_gemini_keys.json has: ${fs.existsSync(workingJsonPath) ? JSON.parse(fs.readFileSync(workingJsonPath, 'utf8')).length : 0} keys`);
  console.log(`   • Fresh working keys detected      : ${activeKeys.length} keys`);

  // If there are working keys, let's keep working_gemini_keys.json up to date
  if (activeKeys.length > 0) {
    fs.writeFileSync(workingJsonPath, JSON.stringify(activeKeys, null, 2), 'utf8');
    console.log(`   • ✅ Automatically updated data/working_gemini_keys.json with ${activeKeys.length} verified active keys!`);

    // Ensure primary key in .env and SQLite app_settings is an active key
    const primaryKey = activeKeys[0];
    try {
      const db = new Database(dbPath);
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gemini_api_key', ?)").run(primaryKey);
      db.close();
      console.log(`   • ✅ Updated SQLite app_settings 'gemini_api_key' to active key (${primaryKey.substring(0, 10)}...)`);
    } catch (e) {
      console.warn(`[Warning] Could not update app.db gemini_api_key:`, e.message);
    }

    try {
      const envPath = path.join(ROOT_DIR, '.env');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        if (/^GEMINI_API_KEY=/m.test(envContent)) {
          envContent = envContent.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY=${primaryKey}`);
        } else {
          envContent += `\nGEMINI_API_KEY=${primaryKey}\n`;
        }
        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log(`   • ✅ Updated .env 'GEMINI_API_KEY' to active key (${primaryKey.substring(0, 10)}...)`);
      }
    } catch (e) {
      console.warn(`[Warning] Could not update .env:`, e.message);
    }
  }

  if (activeKeys.length >= 25) {
    console.log(`\n🚀 CAPACITY STATUS: 100% READY FOR CATALOG HARVEST!`);
    console.log(`   • You have ${activeKeys.length} verified working keys, which fully supplies all 5 isolated harvester pools (5 keys per pool).`);
    console.log(`   • Throughput capacity: up to ~75 requests/minute across all pools without hitting rate limits.`);
  } else if (activeKeys.length > 0) {
    console.log(`\n⚡ CAPACITY STATUS: READY WITH ${activeKeys.length} KEYS`);
    console.log(`   • Can run with ${Math.floor(activeKeys.length / 5)} full pool(s) or custom key round-robin.`);
  } else {
    console.log(`\n❌ ATTENTION: No active keys found. Please add valid Gemini API keys to .env`);
  }

  console.log('\n===============================================================');
}

main().catch(err => {
  console.error('Fatal error during key audit:', err);
  process.exit(1);
});
