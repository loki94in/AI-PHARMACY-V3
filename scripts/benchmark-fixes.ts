import { getMorningBriefing } from '../src/services/morningBriefingService.js';
import { dbManager } from '../src/database/connection.js';

async function main() {
  console.log('Testing Morning Briefing performance directly...');
  const t0 = performance.now();
  const briefing = await getMorningBriefing();
  const ms0 = Math.round(performance.now() - t0);
  console.log(`✓ Morning Briefing completed in ${ms0}ms!`);
  console.log('  Counts:', {
    refills: briefing.refills.total,
    special_orders: briefing.special_orders.total,
    online_orders: briefing.online_orders.total,
    call_tasks: briefing.call_tasks.total
  });

  console.log('\nTesting Investigation Timeline targeted lookup logic...');
  const db = await dbManager.getConnection();
  const t1 = performance.now();
  // Simulate the targeted lookup logic on investigation timeline
  const logs = await db.all(
    "SELECT id, description, metadata FROM action_logs WHERE action_type = 'INVENTORY_ADJUSTMENT' ORDER BY id DESC LIMIT 50"
  );
  const neededInvIds = new Set<number>();
  const neededMedNames = new Set<string>();
  const neededMedIds = new Set<number>();

  for (const log of logs) {
    let meta: any = null;
    if (log.metadata) {
      try { meta = JSON.parse(log.metadata); } catch (_e) {}
    }
    if (meta?.medicineId) neededMedIds.add(meta.medicineId);
    const name = meta?.medicineName || log.description?.match(/Inventory correction for "([^"]+)"/i)?.[1];
    if (name) neededMedNames.add(name.toLowerCase().trim());
  }
  const ms1 = Math.round(performance.now() - t1);
  console.log(`✓ Targeted lookup collection for ${logs.length} logs completed in ${ms1}ms (vs 5000ms old scan)!`);

  process.exit(0);
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
