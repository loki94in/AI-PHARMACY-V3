import fs from 'fs';

/**
 * Automated catalog and distributor reconnection utility.
 * Preserves medicine_distributor_links, distributor_priority, and pharmarack_distributor_mappings
 * across database migrations, swaps, and CSV imports.
 */

export interface DistributorReconnectResult {
  linksRestored: number;
  mappingsRestored: number;
  prioritiesRestored: number;
  restoredFromBackup: boolean;
}

export async function reconnectDistributorLinks(
  db: any,
  backupDbPath?: string | null
): Promise<DistributorReconnectResult> {
  const result: DistributorReconnectResult = {
    linksRestored: 0,
    mappingsRestored: 0,
    prioritiesRestored: 0,
    restoredFromBackup: false
  };

  try {
    // 1. Ensure required tables exist in active db
    await db.run(`
      CREATE TABLE IF NOT EXISTS medicine_distributor_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
        store_id INTEGER NOT NULL,
        store_name TEXT NOT NULL,
        product_code TEXT NOT NULL,
        product_id TEXT,
        product_name TEXT,
        packaging TEXT,
        company TEXT,
        mapped INTEGER DEFAULT 1,
        pick_order INTEGER DEFAULT 0,
        medicine_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(medicine_id, store_id, product_code)
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS distributor_priority (
        name_key TEXT PRIMARY KEY,
        store_name TEXT NOT NULL,
        priority INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS pharmarack_distributor_mappings (
        store_name TEXT PRIMARY KEY,
        distributor_id INTEGER,
        phone TEXT,
        delivery_boy_id INTEGER DEFAULT NULL,
        store_id INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Ensure medicine_name column exists on active medicine_distributor_links
    const mdlCols = await db.all('PRAGMA table_info(medicine_distributor_links)');
    const colNames = new Set((mdlCols || []).map((c: any) => (c.name || '').toLowerCase()));
    if (!colNames.has('medicine_name')) {
      try {
        await db.run('ALTER TABLE medicine_distributor_links ADD COLUMN medicine_name TEXT');
      } catch (_) {}
    }

    // 3. Backfill medicine_name for any active links that have a valid medicine_id
    try {
      await db.run(`
        UPDATE medicine_distributor_links
        SET medicine_name = (
          SELECT m.name FROM medicines m WHERE m.id = medicine_distributor_links.medicine_id LIMIT 1
        )
        WHERE (medicine_name IS NULL OR medicine_name = '')
          AND medicine_id IN (SELECT id FROM medicines)
      `);
    } catch (_) {}

    // 4. If backup exists, attach and restore pre-migration mappings, priorities, and links
    if (backupDbPath && fs.existsSync(backupDbPath)) {
      try {
        await db.run('ATTACH DATABASE ? AS pre_mig_bak', [backupDbPath]);
        result.restoredFromBackup = true;

        // 4a. Restore pharmarack_distributor_mappings
        const bakMapExists = await db.get(
          "SELECT 1 FROM pre_mig_bak.sqlite_master WHERE type='table' AND name='pharmarack_distributor_mappings'"
        );
        if (bakMapExists) {
          try {
            const mapRes = await db.run(`
              INSERT OR IGNORE INTO pharmarack_distributor_mappings (store_name, distributor_id, phone, delivery_boy_id, store_id)
              SELECT store_name, distributor_id, phone, delivery_boy_id, store_id
              FROM pre_mig_bak.pharmarack_distributor_mappings
              WHERE store_name IS NOT NULL AND store_name != ''
            `);
            result.mappingsRestored = mapRes?.changes || 0;
          } catch (mapErr: any) {
            console.warn('[Distributor Reconnect] Mappings restore warning:', mapErr.message);
          }
        }

        // 4b. Restore distributor_priority
        const bakPrioExists = await db.get(
          "SELECT 1 FROM pre_mig_bak.sqlite_master WHERE type='table' AND name='distributor_priority'"
        );
        if (bakPrioExists) {
          try {
            const prioRes = await db.run(`
              INSERT OR IGNORE INTO distributor_priority (name_key, store_name, priority)
              SELECT name_key, store_name, priority
              FROM pre_mig_bak.distributor_priority
              WHERE name_key IS NOT NULL AND name_key != ''
            `);
            result.prioritiesRestored = prioRes?.changes || 0;
          } catch (prioErr: any) {
            console.warn('[Distributor Reconnect] Priority restore warning:', prioErr.message);
          }
        }

        // 4c. Restore distributor contact fields (phone, contact, limits) into distributors table
        const bakDistExists = await db.get(
          "SELECT 1 FROM pre_mig_bak.sqlite_master WHERE type='table' AND name='distributors'"
        );
        if (bakDistExists) {
          try {
            await db.run(`
              UPDATE distributors
              SET 
                phone = COALESCE(distributors.phone, (
                  SELECT bd.phone FROM pre_mig_bak.distributors bd 
                  WHERE LOWER(TRIM(bd.name)) = LOWER(TRIM(distributors.name)) AND bd.phone IS NOT NULL AND bd.phone != '' LIMIT 1
                )),
                contact = COALESCE(distributors.contact, (
                  SELECT bd.contact FROM pre_mig_bak.distributors bd 
                  WHERE LOWER(TRIM(bd.name)) = LOWER(TRIM(distributors.name)) AND bd.contact IS NOT NULL AND bd.contact != '' LIMIT 1
                )),
                min_order_value = COALESCE(distributors.min_order_value, (
                  SELECT bd.min_order_value FROM pre_mig_bak.distributors bd 
                  WHERE LOWER(TRIM(bd.name)) = LOWER(TRIM(distributors.name)) AND bd.min_order_value > 0 LIMIT 1
                )),
                min_order_items = COALESCE(distributors.min_order_items, (
                  SELECT bd.min_order_items FROM pre_mig_bak.distributors bd 
                  WHERE LOWER(TRIM(bd.name)) = LOWER(TRIM(distributors.name)) AND bd.min_order_items > 0 LIMIT 1
                )),
                delivery_boy_id = COALESCE(distributors.delivery_boy_id, (
                  SELECT bd.delivery_boy_id FROM pre_mig_bak.distributors bd 
                  WHERE LOWER(TRIM(bd.name)) = LOWER(TRIM(distributors.name)) AND bd.delivery_boy_id IS NOT NULL LIMIT 1
                ))
              WHERE (phone IS NULL OR phone = '' OR min_order_value IS NULL OR min_order_items IS NULL)
            `);
          } catch (distErr: any) {
            console.warn('[Distributor Reconnect] Distributor contact restore warning:', distErr.message);
          }
        }

        // 4d. Reconnect medicine_distributor_links by matching canonical medicine name
        const bakLinksExists = await db.get(
          "SELECT 1 FROM pre_mig_bak.sqlite_master WHERE type='table' AND name='medicine_distributor_links'"
        );
        if (bakLinksExists) {
          // Check if backup has medicines table to resolve medicine_name
          const bakMedExists = await db.get(
            "SELECT 1 FROM pre_mig_bak.sqlite_master WHERE type='table' AND name='medicines'"
          );

          let bakRows: any[] = [];
          if (bakMedExists) {
            bakRows = await db.all(`
              SELECT 
                l.store_id, l.store_name, l.product_code, l.product_id, l.product_name,
                l.packaging, l.company, l.mapped, l.pick_order,
                COALESCE(NULLIF(l.product_name, ''), m.name) AS raw_med_name,
                m.name AS canonical_med_name
              FROM pre_mig_bak.medicine_distributor_links l
              LEFT JOIN pre_mig_bak.medicines m ON m.id = l.medicine_id
              WHERE l.store_id > 0 AND l.product_code IS NOT NULL AND l.product_code != ''
            `);
          } else {
            bakRows = await db.all(`
              SELECT 
                store_id, store_name, product_code, product_id, product_name,
                packaging, company, mapped, pick_order, product_name AS raw_med_name,
                product_name AS canonical_med_name
              FROM pre_mig_bak.medicine_distributor_links
              WHERE store_id > 0 AND product_code IS NOT NULL AND product_code != ''
            `);
          }

          if (bakRows.length > 0) {
            console.log(`[Distributor Reconnect] Reconnecting ${bakRows.length} distributor link(s) from backup...`);
            let restoredCount = 0;

            for (const r of bakRows) {
              const medName = String(r.canonical_med_name || r.raw_med_name || '').trim();
              if (!medName) continue;

              // Find matching medicine in new active catalog
              let targetMed = await db.get(
                `SELECT id, name FROM medicines WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
                [medName]
              );

              if (!targetMed?.id) {
                // Secondary fallback: strip package form/counts
                const cleanName = medName.replace(/\s*\([^)]*\)\s*$/g, '').replace(/\s+\d+('?s|x\d+)?$/i, '').trim();
                targetMed = await db.get(
                  `SELECT id, name FROM medicines WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
                  [cleanName]
                );
              }

              if (targetMed?.id) {
                await db.run(
                  `INSERT INTO medicine_distributor_links 
                     (medicine_id, store_id, store_name, product_code, product_id, product_name, packaging, company, mapped, pick_order, medicine_name, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(medicine_id, store_id, product_code) DO UPDATE SET
                     medicine_name = excluded.medicine_name,
                     store_name = CASE WHEN excluded.store_name != '' THEN excluded.store_name ELSE medicine_distributor_links.store_name END,
                     product_name = CASE WHEN excluded.product_name != '' THEN excluded.product_name ELSE medicine_distributor_links.product_name END,
                     updated_at = CURRENT_TIMESTAMP`,
                  [
                    targetMed.id,
                    Number(r.store_id),
                    String(r.store_name || '').trim(),
                    String(r.product_code || '').trim(),
                    r.product_id ? String(r.product_id) : null,
                    r.product_name || null,
                    r.packaging || null,
                    r.company || null,
                    r.mapped !== 0 ? 1 : 0,
                    Number(r.pick_order || 0),
                    targetMed.name
                  ]
                );
                restoredCount++;
              }
            }
            result.linksRestored = restoredCount;
            console.log(`[Distributor Reconnect] Successfully restored ${restoredCount} link(s) to active catalog.`);
          }
        }

        // 4e. Also restore pharmarack_distributor_products if active table is empty
        const bakProdExists = await db.get(
          "SELECT 1 FROM pre_mig_bak.sqlite_master WHERE type='table' AND name='pharmarack_distributor_products'"
        );
        if (bakProdExists) {
          const activeProdCount = await db.get('SELECT COUNT(*) as c FROM pharmarack_distributor_products').catch(() => ({ c: 0 }));
          if ((activeProdCount?.c || 0) === 0) {
            try {
              await db.run(`
                INSERT OR IGNORE INTO pharmarack_distributor_products
                SELECT * FROM pre_mig_bak.pharmarack_distributor_products
              `);
            } catch (_) {}
          }
        }

        await db.run('DETACH DATABASE pre_mig_bak');
      } catch (attachErr: any) {
        console.warn('[Distributor Reconnect] Backup attach warning:', attachErr?.message);
        try { await db.run('DETACH DATABASE pre_mig_bak'); } catch (_) {}
      }
    }
  } catch (err: any) {
    console.error('[Distributor Reconnect] Unexpected error:', err?.message || err);
  }

  return result;
}

