import fs from 'fs';

/**
 * Automated catalog reconnection utility for patient_refills and refill_fulfillments.
 * Resolves orphaned medicine_ids and customer_ids after database migrations, catalog refreshes,
 * or CSV imports, ensuring zero refill loss in CRM and POS.
 */

export interface RefillReconnectResult {
  totalChecked: number;
  orphanedRefills: number;
  remappedRefills: number;
  remappedFulfillments: number;
  remappedCustomers: number;
  restoredFromBackup: boolean;
}

export async function reconnectPatientRefillsCatalog(
  db: any,
  backupDbPath?: string | null
): Promise<RefillReconnectResult> {
  const result: RefillReconnectResult = {
    totalChecked: 0,
    orphanedRefills: 0,
    remappedRefills: 0,
    remappedFulfillments: 0,
    remappedCustomers: 0,
    restoredFromBackup: false
  };

  try {
    // 1. Ensure patient_refills table exists
    const tableExists = await db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='patient_refills'");
    if (!tableExists) return result;

    // 2. Ensure medicine_name column exists on patient_refills for permanent zero-orphan protection
    const prCols = await db.all('PRAGMA table_info(patient_refills)');
    const colNames = new Set((prCols || []).map((c: any) => (c.name || '').toLowerCase()));
    if (!colNames.has('medicine_name')) {
      try {
        await db.run('ALTER TABLE patient_refills ADD COLUMN medicine_name TEXT');
      } catch (_) {}
    }

    // 3. Check row count in active patient_refills
    let countRow = await db.get('SELECT COUNT(*) as c FROM patient_refills');
    result.totalChecked = countRow?.c || 0;

    // 4. If patient_refills is empty in the newly migrated DB, but a backup exists, restore shop refills!
    if (result.totalChecked === 0 && backupDbPath && fs.existsSync(backupDbPath)) {
      try {
        await db.run('ATTACH DATABASE ? AS pre_mig_bak', [backupDbPath]);
        const bakRefillTable = await db.get("SELECT 1 FROM pre_mig_bak.sqlite_master WHERE type='table' AND name='patient_refills'");
        if (bakRefillTable) {
          const bakCount = await db.get('SELECT COUNT(*) as c FROM pre_mig_bak.patient_refills');
          if (bakCount?.c > 0) {
            console.log(`[Refill Reconnect] Restoring ${bakCount.c} patient refills from pre-migration backup...`);
            await db.run(`
              INSERT OR IGNORE INTO patient_refills 
              SELECT * FROM pre_mig_bak.patient_refills
            `);
            result.restoredFromBackup = true;

            // Also restore refill_fulfillments if empty
            const fulCount = await db.get('SELECT COUNT(*) as c FROM refill_fulfillments');
            if ((fulCount?.c || 0) === 0) {
              const bakFulTable = await db.get("SELECT 1 FROM pre_mig_bak.sqlite_master WHERE type='table' AND name='refill_fulfillments'");
              if (bakFulTable) {
                await db.run(`
                  INSERT OR IGNORE INTO refill_fulfillments 
                  SELECT * FROM pre_mig_bak.refill_fulfillments
                `);
              }
            }
          }
        }
        await db.run('DETACH DATABASE pre_mig_bak');
        countRow = await db.get('SELECT COUNT(*) as c FROM patient_refills');
        result.totalChecked = countRow?.c || 0;
      } catch (attachErr: any) {
        console.warn('[Refill Reconnect] Backup attach warning:', attachErr?.message);
        try { await db.run('DETACH DATABASE pre_mig_bak'); } catch (_) {}
      }
    }

    if (result.totalChecked === 0) return result;

    // 5. Backfill any missing medicine_name using existing valid medicine_id
    try {
      await db.run(`
        UPDATE patient_refills 
        SET medicine_name = (
          SELECT m.name FROM medicines m WHERE m.id = patient_refills.medicine_id LIMIT 1
        )
        WHERE (medicine_name IS NULL OR medicine_name = '') 
          AND medicine_id IN (SELECT id FROM medicines)
      `);
    } catch (_) {}

    // 6. Detect orphaned refills where medicine_id does not exist in medicines
    const orphanedRows = await db.all(`
      SELECT pr.id, pr.customer_id, pr.patient_name, pr.patient_phone, pr.medicine_id, 
             pr.medicine_name, pr.cart_product_name
      FROM patient_refills pr
      LEFT JOIN medicines m ON m.id = pr.medicine_id
      WHERE m.id IS NULL
    `);

    result.orphanedRefills = orphanedRows.length;

    // Check if pre-reconnect backup table exists
    const hasPreReconnectBackup = await db.get(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='_backup_patient_refills_pre_reconnect'"
    );

    // 7. Remap orphaned refills by canonical medicine name
    for (const row of orphanedRows) {
      let targetMedName: string | null = row.medicine_name || row.cart_product_name || null;

      // Try resolving name from fulfillment history if not on row
      if (!targetMedName) {
        const ful = await db.get(
          'SELECT medicine_name FROM refill_fulfillments WHERE refill_id = ? AND medicine_name IS NOT NULL LIMIT 1',
          [row.id]
        );
        if (ful?.medicine_name) {
          targetMedName = ful.medicine_name;
        }
      }

      // Try resolving from pre-reconnect backup snapshot if present
      if (!targetMedName && hasPreReconnectBackup) {
        const bakRow = await db.get(
          'SELECT cart_product_name, medicine_name FROM _backup_patient_refills_pre_reconnect WHERE id = ?',
          [row.id]
        );
        if (bakRow?.medicine_name) {
          targetMedName = bakRow.medicine_name;
        } else if (bakRow?.cart_product_name) {
          targetMedName = bakRow.cart_product_name;
        }
      }

      // Try resolving from pre-migration backup database if provided
      if (!targetMedName && backupDbPath && fs.existsSync(backupDbPath)) {
        try {
          await db.run('ATTACH DATABASE ? AS pre_mig_bak', [backupDbPath]);
          const oldMed = await db.get(
            'SELECT name FROM pre_mig_bak.medicines WHERE id = ? LIMIT 1',
            [row.medicine_id]
          );
          if (oldMed?.name) {
            targetMedName = oldMed.name;
          }
          await db.run('DETACH DATABASE pre_mig_bak');
        } catch (_) {
          try { await db.run('DETACH DATABASE pre_mig_bak'); } catch (_) {}
        }
      }

      // Match against new medicines catalog
      if (targetMedName) {
        let matchedMed = await db.get(
          'SELECT id FROM medicines WHERE name = ? COLLATE NOCASE LIMIT 1',
          [targetMedName]
        );

        if (!matchedMed) {
          matchedMed = await db.get(
            'SELECT id FROM medicines WHERE name LIKE ? LIMIT 1',
            [`%${targetMedName.trim()}%`]
          );
        }

        if (matchedMed?.id) {
          await db.run(
            'UPDATE patient_refills SET medicine_id = ?, medicine_name = ? WHERE id = ?',
            [matchedMed.id, targetMedName, row.id]
          );
          result.remappedRefills++;
        } else {
          // If no matching medicine exists in catalog yet, preserve the medicine_name directly on the row
          await db.run(
            'UPDATE patient_refills SET medicine_name = ? WHERE id = ?',
            [targetMedName, row.id]
          );
        }
      }

      // Resolve customer_id if broken or unlinked
      if (row.customer_id) {
        const custExists = await db.get('SELECT 1 FROM customers WHERE id = ?', [row.customer_id]);
        if (!custExists) {
          let cleanPhone = (row.patient_phone || '').replace(/\D/g, '').slice(-10);
          let foundCust: any = null;
          if (cleanPhone.length === 10) {
            foundCust = await db.get('SELECT id FROM customers WHERE phone LIKE ? LIMIT 1', [`%${cleanPhone}`]);
          }
          if (!foundCust && row.patient_name) {
            foundCust = await db.get('SELECT id FROM customers WHERE name = ? COLLATE NOCASE LIMIT 1', [row.patient_name]);
          }
          if (foundCust?.id) {
            await db.run('UPDATE patient_refills SET customer_id = ? WHERE id = ?', [foundCust.id, row.id]);
            result.remappedCustomers++;
          }
        }
      }
    }

    // 8. Heal any orphaned refill_fulfillments
    const fulTableExists = await db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='refill_fulfillments'");
    if (fulTableExists) {
      const orphanedFulfillments = await db.all(`
        SELECT rf.id, rf.medicine_name
        FROM refill_fulfillments rf
        LEFT JOIN medicines m ON m.id = rf.medicine_id
        WHERE m.id IS NULL AND rf.medicine_name IS NOT NULL
      `);

      for (const f of orphanedFulfillments) {
        const match = await db.get(
          'SELECT id FROM medicines WHERE name = ? COLLATE NOCASE LIMIT 1',
          [f.medicine_name]
        );
        if (match?.id) {
          await db.run('UPDATE refill_fulfillments SET medicine_id = ? WHERE id = ?', [match.id, f.id]);
          result.remappedFulfillments++;
        }
      }
    }

    return result;
  } catch (err: any) {
    console.warn('[Refill Reconnect] Failed during auto-reconnection:', err?.message);
    return result;
  }
}
