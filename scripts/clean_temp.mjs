import Database from 'better-sqlite3';

const db = new Database('./data/app.db');

const del = db.prepare(`DELETE FROM catalog_images WHERE matching_method = 'ai_multi_signal_strict' OR matching_method = 'canonical_surgical'`).run();
const hist = db.prepare(`DELETE FROM image_review_history WHERE performed_by = 'catalog_master_engine'`).run();

console.log(`Deleted ${del.changes} test images and ${hist.changes} history entries.`);
