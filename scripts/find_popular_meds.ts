import { dbManager } from '../src/database/connection.js';

async function main() {
  const db = await dbManager.getConnection();
  const searchTerms = [
    'TELMA 40MG TABLET',
    'DOLO 650',
    'PAN 40MG TABLET',
    'DISPOVAN 5ML',
    'BETADINE 10% OINTMENT',
    'AUGMENTIN 625',
    'GELUSIL MPS',
    'VOLINI GEL',
    'ASCORIL D PLUS',
    'LULICONAZOLE'
  ];

  for (const term of searchTerms) {
    const row = await db.get(
      'SELECT id, name, packaging, manufacturer, item_type FROM medicines WHERE name LIKE ? LIMIT 1',
      [`%${term}%`]
    );
    if (row) {
      console.log(JSON.stringify(row));
    }
  }
}

main().catch(console.error);
