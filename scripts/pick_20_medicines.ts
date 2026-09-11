import { dbManager } from '../src/database/connection.js';

async function main() {
  const db = await dbManager.getConnection();
  
  // Exclude the ones we already tested:
  const excludedIds = [286089, 278825, 71503, 278923, 278968, 281310, 90709, 175958, 64327];
  
  // Pick diverse common medicines across dosage forms: tablets, capsules, syrups, ointments, drops, inhalers, surgicals
  const categories = [
    { type: 'Tablet', query: `SELECT id, name, packaging, manufacturer, item_type FROM medicines WHERE (name LIKE '%TAB%' OR packaging LIKE '%TAB%') AND id NOT IN (${excludedIds.join(',')}) ORDER BY RANDOM() LIMIT 6` },
    { type: 'Capsule', query: `SELECT id, name, packaging, manufacturer, item_type FROM medicines WHERE (name LIKE '%CAP%' OR packaging LIKE '%CAP%') AND id NOT IN (${excludedIds.join(',')}) ORDER BY RANDOM() LIMIT 4` },
    { type: 'Syrup', query: `SELECT id, name, packaging, manufacturer, item_type FROM medicines WHERE (name LIKE '%SYP%' OR name LIKE '%SYRUP%' OR name LIKE '%SUSP%') AND id NOT IN (${excludedIds.join(',')}) ORDER BY RANDOM() LIMIT 3` },
    { type: 'Drops', query: `SELECT id, name, packaging, manufacturer, item_type FROM medicines WHERE name LIKE '%DROP%' AND id NOT IN (${excludedIds.join(',')}) ORDER BY RANDOM() LIMIT 3` },
    { type: 'Topical', query: `SELECT id, name, packaging, manufacturer, item_type FROM medicines WHERE (name LIKE '%OINT%' OR name LIKE '%GEL%' OR name LIKE '%CREAM%') AND id NOT IN (${excludedIds.join(',')}) ORDER BY RANDOM() LIMIT 2` },
    { type: 'Inhaler / Device / Other', query: `SELECT id, name, packaging, manufacturer, item_type FROM medicines WHERE (name LIKE '%RESP%' OR name LIKE '%ROTACAP%' OR name LIKE '%INHALER%' OR name LIKE '%NEEDLE%' OR name LIKE '%DISPO%') AND id NOT IN (${excludedIds.join(',')}) ORDER BY RANDOM() LIMIT 4` },
  ];

  const selected: any[] = [];
  const seenIds = new Set<number>();

  for (const cat of categories) {
    const rows = await db.all(cat.query);
    for (const r of rows) {
      if (!seenIds.has(r.id) && selected.length < 20) {
        seenIds.add(r.id);
        selected.push({ ...r, category: cat.type });
      }
    }
  }

  console.log(`Selected ${selected.length} medicines:`);
  console.log(JSON.stringify(selected, null, 2));
}

main().catch(console.error);
