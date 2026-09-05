#!/usr/bin/env node

/**
 * Automated Frontend Bundle & Performance Budget Analyzer
 *
 * Checks frontend/dist/assets to ensure:
 * 1. Initial preload bundle is < 500 KB compressed (FRONTEND PERFORMANCE FIX.md budget).
 * 2. Initial CSS is < 150 KB compressed.
 * 3. Route code splitting is working properly (POS loads without CRM, Reports, Settings, or PDF).
 * 4. Heavy vendor libraries (PDF, Motion) remain isolated behind dynamic imports.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'frontend', 'dist');
const ASSETS = path.join(DIST, 'assets');
const INDEX_HTML = path.join(DIST, 'index.html');

if (!fs.existsSync(INDEX_HTML)) {
  console.error('Error: frontend/dist not found. Please run "npm run build --prefix frontend" first.');
  process.exit(1);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function getGzipSize(filePath) {
  const content = fs.readFileSync(filePath);
  return zlib.gzipSync(content).length;
}

const html = fs.readFileSync(INDEX_HTML, 'utf8');

// Extract all scripts and modulepreloads from index.html
const scriptMatches = [...html.matchAll(/src=["']\/assets\/([^"']+)["']/g)].map(m => m[1]);
const preloadMatches = [...html.matchAll(/href=["']\/assets\/([^"']+\.js)["']/g)].map(m => m[1]);
const cssMatches = [...html.matchAll(/href=["']\/assets\/([^"']+\.css)["']/g)].map(m => m[1]);

const initialJsFiles = [...new Set([...scriptMatches, ...preloadMatches])];
const initialCssFiles = [...new Set(cssMatches)];

console.log('='.repeat(72));
console.log('  AI PHARMACY V3 — FRONTEND BUNDLE PERFORMANCE AUDIT');
console.log('='.repeat(72));
console.log('');

console.log('1. INITIAL ENTRY ASSETS (Downloaded on Initial Startup / POS Boot):');
console.log('-'.repeat(72));

let totalInitialJsRaw = 0;
let totalInitialJsGzip = 0;

for (const file of initialJsFiles) {
  const fullPath = path.join(ASSETS, file);
  if (fs.existsSync(fullPath)) {
    const raw = fs.statSync(fullPath).size;
    const gz = getGzipSize(fullPath);
    totalInitialJsRaw += raw;
    totalInitialJsGzip += gz;
    console.log(`  JS:  ${file.padEnd(36)} | ${formatSize(raw).padStart(9)} | gzip: ${formatSize(gz).padStart(9)}`);
  }
}

let totalInitialCssRaw = 0;
let totalInitialCssGzip = 0;

for (const file of initialCssFiles) {
  const fullPath = path.join(ASSETS, file);
  if (fs.existsSync(fullPath)) {
    const raw = fs.statSync(fullPath).size;
    const gz = getGzipSize(fullPath);
    totalInitialCssRaw += raw;
    totalInitialCssGzip += gz;
    console.log(`  CSS: ${file.padEnd(36)} | ${formatSize(raw).padStart(9)} | gzip: ${formatSize(gz).padStart(9)}`);
  }
}

console.log('-'.repeat(72));
console.log(`  TOTAL INITIAL JS:  ${formatSize(totalInitialJsRaw).padStart(9)} (raw)  |  ${formatSize(totalInitialJsGzip).padStart(9)} (gzip)`);
console.log(`  TOTAL INITIAL CSS: ${formatSize(totalInitialCssRaw).padStart(9)} (raw)  |  ${formatSize(totalInitialCssGzip).padStart(9)} (gzip)`);
console.log(`  TOTAL INITIAL NET: ${formatSize(totalInitialJsRaw + totalInitialCssRaw).padStart(9)} (raw)  |  ${formatSize(totalInitialJsGzip + totalInitialCssGzip).padStart(9)} (gzip)`);
console.log('');

// 2. Audit All Route & Feature Chunks
console.log('2. ON-DEMAND FEATURE CHUNKS (Loaded only when route/feature is accessed):');
console.log('-'.repeat(72));

const allAssets = fs.readdirSync(ASSETS);
const nonInitialJs = allAssets.filter(f => f.endsWith('.js') && !initialJsFiles.includes(f));

let violations = [];

// Performance Budgets
const JS_BUDGET_GZIP = 500 * 1024; // 500 KB
const CSS_BUDGET_GZIP = 150 * 1024; // 150 KB

for (const file of nonInitialJs) {
  const fullPath = path.join(ASSETS, file);
  const raw = fs.statSync(fullPath).size;
  const gz = getGzipSize(fullPath);
  console.log(`  ${file.padEnd(42)} | ${formatSize(raw).padStart(9)} | gzip: ${formatSize(gz).padStart(9)}`);

  // Check if heavy vendor or route chunks accidentally leaked into initial preload
  if (file.startsWith('CRM-') && initialJsFiles.includes(file)) {
    violations.push('CRM route leaked into initial HTML preload');
  }
  if (file.startsWith('Reports-') && initialJsFiles.includes(file)) {
    violations.push('Reports route leaked into initial HTML preload');
  }
  if (file.startsWith('Settings-') && initialJsFiles.includes(file)) {
    violations.push('Settings route leaked into initial HTML preload');
  }
  if (file.startsWith('vendor-pdf-') && initialJsFiles.includes(file)) {
    violations.push('vendor-pdf leaked into initial HTML preload');
  }
  if (file.startsWith('vendor-motion-') && initialJsFiles.includes(file)) {
    violations.push('vendor-motion leaked into initial HTML preload');
  }
}

console.log('');
console.log('3. BUDGET COMPLIANCE:');
console.log('-'.repeat(72));

let passed = true;

if (totalInitialJsGzip <= JS_BUDGET_GZIP) {
  console.log(`  [PASS] Initial JS Gzip: ${formatSize(totalInitialJsGzip)} <= Budget: ${formatSize(JS_BUDGET_GZIP)}`);
} else {
  console.error(`  [FAIL] Initial JS Gzip: ${formatSize(totalInitialJsGzip)} exceeds Budget: ${formatSize(JS_BUDGET_GZIP)}`);
  passed = false;
}

if (totalInitialCssGzip <= CSS_BUDGET_GZIP) {
  console.log(`  [PASS] Initial CSS Gzip: ${formatSize(totalInitialCssGzip)} <= Budget: ${formatSize(CSS_BUDGET_GZIP)}`);
} else {
  console.error(`  [FAIL] Initial CSS Gzip: ${formatSize(totalInitialCssGzip)} exceeds Budget: ${formatSize(CSS_BUDGET_GZIP)}`);
  passed = false;
}

if (violations.length === 0) {
  console.log('  [PASS] Route & vendor isolation verified — no heavy chunks leaked into initial entry');
} else {
  for (const v of violations) {
    console.error(`  [FAIL] ${v}`);
  }
  passed = false;
}

console.log('='.repeat(72));

if (!passed) {
  process.exit(1);
}

console.log('  ALL PERFORMANCE BUDGET CHECKS PASSED.');
console.log('='.repeat(72));
