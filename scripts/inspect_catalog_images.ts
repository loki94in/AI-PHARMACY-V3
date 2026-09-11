import { dbManager } from '../src/database/connection.js';

async function checkCatalogImages() {
  const db = await dbManager.getConnection();
  const rows = await db.all(`
    SELECT ci.id, ci.medicine_id, m.name, ci.product_name, ci.image_type, ci.image_path, ci.confidence_score, ci.verification_status 
    FROM catalog_images ci 
    JOIN medicines m ON m.id = ci.medicine_id 
    ORDER BY ci.id ASC
  `);
  console.log(`Total images in catalog_images: ${rows.length}`);
  console.table(rows);
}

checkCatalogImages().catch(console.error);
