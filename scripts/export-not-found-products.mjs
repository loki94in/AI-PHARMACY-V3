import fs from 'fs';
import path from 'path';

const ROOT_DIR = 'e:/CURRENT PROJECT ON WORKING/AI PHARMACY v2';
const STATE_FILE = path.join(ROOT_DIR, 'data', 'image_download_state.json');
const ARTIFACT_PATH = 'C:/Users/ratna/.gemini/antigravity-ide/brain/82e70d8b-859e-4544-bf42-1148272d52d8/not_found_products.md';
const CSV_EXPORT_PATH = path.join(ROOT_DIR, 'CATALOG', 'images_not_found_products.csv');

const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));

const notFounds = Object.entries(state.products)
  .filter(([k, v]) => v.status === 'not_found')
  .map(([k, v]) => ({
    name: k,
    query: v.searched_query || ''
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// 1. Build Markdown Artifact
let md = '# List of 460 Products Not Found Online\n\n';
md += 'This document contains all **460 medicines** from your inventory catalog where automated online search did not find an image during the initial run.\n\n';

const byLetter = {};
for (const item of notFounds) {
  const firstChar = item.name.trim().charAt(0).toUpperCase();
  const letter = (firstChar >= 'A' && firstChar <= 'Z') ? firstChar : '#';
  if (!byLetter[letter]) byLetter[letter] = [];
  byLetter[letter].push(item);
}

const letters = Object.keys(byLetter).sort((a, b) => {
  if (a === '#') return -1;
  if (b === '#') return 1;
  return a.localeCompare(b);
});

md += '### Quick Index\n\n';
md += letters.map(l => `[**${l}**](#section-${l === '#' ? 'num' : l.toLowerCase()}) (${byLetter[l].length})`).join(' · ') + '\n\n---\n\n';

let globalIndex = 1;
for (const l of letters) {
  const secId = l === '#' ? 'num' : l.toLowerCase();
  md += `## Section ${l} <a id="section-${secId}"></a> (${byLetter[l].length} products)\n\n`;
  md += '| # | Raw Inventory Product Name | Cleaned Search Query |\n';
  md += '| :--- | :--- | :--- |\n';
  for (const item of byLetter[l]) {
    const escapedName = item.name.replace(/\|/g, '\\|');
    const escapedQuery = item.query.replace(/\|/g, '\\|');
    md += `| ${globalIndex++} | ${escapedName} | ${escapedQuery} |\n`;
  }
  md += '\n';
}

fs.writeFileSync(ARTIFACT_PATH, md, 'utf-8');

// 2. Build CSV export
let csv = 'Index,Product Name,Cleaned Query\n';
let idx = 1;
for (const item of notFounds) {
  const safeName = '"' + item.name.replace(/"/g, '""') + '"';
  const safeQuery = '"' + item.query.replace(/"/g, '""') + '"';
  csv += `${idx++},${safeName},${safeQuery}\n`;
}
fs.writeFileSync(CSV_EXPORT_PATH, csv, 'utf-8');

console.log(`Generated:
  - Markdown: ${ARTIFACT_PATH} (${notFounds.length} items)
  - CSV: ${CSV_EXPORT_PATH} (${notFounds.length} items)
`);
