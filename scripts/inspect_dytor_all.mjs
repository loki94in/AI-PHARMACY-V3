import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const rows = db.prepare(`
  SELECT 
    ci.id,
    ci.medicine_id,
    m.name as medicine_name,
    ci.product_name,
    ci.image_path,
    ci.is_primary,
    ci.is_active,
    ci.verification_status,
    ci.confidence_score
  FROM catalog_images ci
  JOIN medicines m ON ci.medicine_id = m.id
  WHERE m.name LIKE '%DYTOR%'
  ORDER BY m.name ASC, ci.id ASC
`).all();

console.log('All Dytor catalog images:');
for (const r of rows) {
  console.log(`[CI ${r.id}] Med: "${r.medicine_name}" (MedID: ${r.medicine_id}) | Active: ${r.is_active} | Primary: ${r.is_primary} | ImgPath: "${r.image_path}" | ProdName: "${r.product_name}"`);
}
