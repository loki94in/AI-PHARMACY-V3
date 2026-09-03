import { catalogImageService } from '../src/services/catalogImageService.js';
import { dbManager } from '../src/database/connection.js';

async function main() {
  console.log('Starting multi-angle image synchronization...');
  const res = await catalogImageService.syncMultiAngleImages();
  console.log(`Synchronization complete! Added ${res.added} angles across ${res.total} state entries.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Failed to sync multi-angles:', err);
  process.exit(1);
});
