// Run ensureSchema to apply Schema v53
import { config } from '../src/config/index.js';
import { ensureSchema } from '../src/database.js';

async function run() {
  console.log('Running ensureSchema()...');
  await ensureSchema(config.dbPath);
  console.log('ensureSchema() completed successfully.');
  process.exit(0);
}

run().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
