#!/usr/bin/env node

/**
 * scripts/harvest_status.ts
 * Displays high-level audit of company catalogues, disk image counts, and SQLite verification status.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'harvest_company_progress.json');
const FRONTEND_PRODUCTS = path.join(ROOT_DIR, 'frontend', 'public', 'products');

const db = new Database(DB_PATH);

function slugifyCompany(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

console.log('='.repeat(80));
console.log('       CATALOG IMAGE HARVESTING — COMPANY STATUS DASHBOARD');
console.log('='.repeat(80));

let state = { completed_companies: [] as string[], products: {} as Record<string, any> };
if (fs.existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {}
}

const topCompanies = db.prepare(`
  SELECT manufacturer, COUNT(*) as count
  FROM medicines
  WHERE manufacturer IS NOT NULL AND TRIM(manufacturer) != ''
  GROUP BY manufacturer
  ORDER BY count DESC
  LIMIT 20
`).all() as { manufacturer: string; count: number }[];

console.log(`\nCompleted Companies (${state.completed_companies.length}):`);
if (state.completed_companies.length === 0) {
  console.log('   (None completed yet — pipeline in progress)');
} else {
  state.completed_companies.forEach((c, idx) => console.log(`   ✅ ${idx + 1}. ${c}`));
}

console.log(`\nTop 20 Company Catalogues Status:`);
console.log('─'.repeat(80));
console.log(
  'Company'.padEnd(35) +
  'Total Meds'.padEnd(12) +
  'On Disk'.padEnd(12) +
  'Processed'.padEnd(12) +
  'Status'
);
console.log('─'.repeat(80));

topCompanies.forEach(c => {
  const compSlug = slugifyCompany(c.manufacturer);
  const dirPath = path.join(FRONTEND_PRODUCTS, compSlug);
  const diskCount = fs.existsSync(dirPath) ? fs.readdirSync(dirPath).length : 0;
  
  // Count processed in state for this company
  let processedCount = 0;
  for (const p of Object.values(state.products)) {
    if (p.company === c.manufacturer) processedCount++;
  }

  const isCompleted = state.completed_companies.includes(c.manufacturer);
  const statusStr = isCompleted ? '✅ COMPLETED' : (processedCount > 0 ? '🔄 IN PROGRESS' : '⏳ QUEUED');

  console.log(
    c.manufacturer.slice(0, 33).padEnd(35) +
    String(c.count).padEnd(12) +
    String(diskCount).padEnd(12) +
    String(processedCount).padEnd(12) +
    statusStr
  );
});

console.log('─'.repeat(80));

const dbStats = db.prepare(`
  SELECT verification_status, count(*) as count
  FROM catalog_images
  GROUP BY verification_status
`).all() as { verification_status: string; count: number }[];

console.log('\nSQLite `catalog_images` Table Status:');
dbStats.forEach(s => {
  console.log(`   - ${s.verification_status.padEnd(20)}: ${s.count}`);
});

console.log('\n' + '='.repeat(80) + '\n');
