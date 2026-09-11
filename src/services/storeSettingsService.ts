import { dbManager } from '../database/connection.js';
import { formatCustomerName } from '../utils/nameFormatter.js';

/**
 * Resolves the user-configured pharmacy name from app_settings.
 * Returns null if no valid pharmacy name is configured.
 * Strictly blocks placeholder/dummy pharmacy identities.
 */
export async function getConfiguredPharmacyName(dbInstance?: any): Promise<string | null> {
  try {
    const db = dbInstance || (await dbManager.getConnection());

    const row = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('shop_name', 'store_name', 'pharmacy_name', 'medical_name') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
       ORDER BY CASE key 
         WHEN 'shop_name' THEN 1 
         WHEN 'store_name' THEN 2 
         WHEN 'pharmacy_name' THEN 3 
         WHEN 'medical_name' THEN 4 
         ELSE 5 END 
       LIMIT 1`
    );

    if (row && row.value && row.value.trim()) {
      const val = row.value.trim();
      const lower = val.toLowerCase();
      if (
        lower === 'xyz medical' ||
        lower === 'xyz pharmacy' ||
        lower === 'xyz'
      ) {
        return null;
      }
      return val;
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving configured pharmacy name:', err);
  }
  return null;
}

/**
 * Resolves the configured pharmacy store / medical name from app_settings dynamically.
 * Prioritizes store-specific name if storeId is supplied, then user-configured shop_name / store_name / pharmacy_name.
 */
export async function getStoreMedicalName(dbInstance?: any, storeId?: number): Promise<string> {
  try {
    const db = dbInstance || (await dbManager.getConnection());

    if (storeId && storeId > 0) {
      const storeRow = await db.get('SELECT name FROM stores WHERE id = ?', [storeId]).catch(() => null);
      if (storeRow && storeRow.name && storeRow.name.trim() && storeRow.name.trim().toLowerCase() !== 'main store') {
        return storeRow.name.trim();
      }
    }

    // Primary lookup: shop_name, store_name, pharmacy_name, medical_name (excluding legacy placeholders)
    const row = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('shop_name', 'store_name', 'pharmacy_name', 'medical_name') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
         AND TRIM(value) != 'XYZ MEDICAL' 
         AND TRIM(value) != 'XYZ Pharmacy'
       ORDER BY CASE key 
         WHEN 'shop_name' THEN 1 
         WHEN 'store_name' THEN 2 
         WHEN 'pharmacy_name' THEN 3 
         ELSE 4 END 
       LIMIT 1`
    );

    if (row && row.value && row.value.trim()) {
      return row.value.trim();
    }

    // Secondary lookup: any non-empty value
    const fallbackRow = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('shop_name', 'store_name', 'pharmacy_name', 'medical_name') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
       LIMIT 1`
    );

    if (fallbackRow && fallbackRow.value && fallbackRow.value.trim()) {
      const val = fallbackRow.value.trim();
      if (val !== 'XYZ MEDICAL' && val !== 'XYZ Pharmacy') {
        return val;
      }
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving store medical name:', err);
  }
  return 'AI PHARMACY';
}

/**
 * Resolves the configured store phone / contact number from app_settings dynamically.
 */
export async function getStorePhone(dbInstance?: any, storeId?: number): Promise<string> {
  try {
    const db = dbInstance || (await dbManager.getConnection());

    if (storeId && storeId > 0) {
      const storeRow = await db.get('SELECT phone FROM stores WHERE id = ?', [storeId]).catch(() => null);
      if (storeRow && storeRow.phone && storeRow.phone.trim()) {
        return storeRow.phone.trim();
      }

      // Check branch-specific phone from store_settings
      const storeSettingRow = await db.get(
        `SELECT value FROM store_settings 
         WHERE store_id = ? AND key IN ('phone', 'store_phone', 'whatsapp_number', 'shop_phone', 'contact_number')
           AND value IS NOT NULL AND TRIM(value) != ''
         ORDER BY CASE key
           WHEN 'phone' THEN 1
           WHEN 'store_phone' THEN 2
           WHEN 'whatsapp_number' THEN 3
           ELSE 4 END
         LIMIT 1`,
        [storeId]
      ).catch(() => null);
      if (storeSettingRow && storeSettingRow.value && storeSettingRow.value.trim()) {
        return storeSettingRow.value.trim();
      }
    }

    const row = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('shop_phone', 'store_phone', 'pharmacy_phone', 'phone', 'contact_number', 'phone_number', 'owner_whatsapp_number', 'whatsapp_connected_number') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
       ORDER BY CASE key 
         WHEN 'shop_phone' THEN 1 
         WHEN 'store_phone' THEN 2 
         WHEN 'owner_whatsapp_number' THEN 3
         WHEN 'whatsapp_connected_number' THEN 4
         WHEN 'pharmacy_phone' THEN 5 
         WHEN 'phone' THEN 6
         ELSE 7 END 
       LIMIT 1`
    );

    if (row && row.value && row.value.trim()) {
      return row.value.trim();
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving store phone:', err);
  }
  return '';
}

/**
 * Resolves the Pharmacy / Owner WhatsApp & phone number strictly for major system reports
 * (Monthly, Expiry, Bounced Alert, Shortage/Admin Order Reminders, Non-Moving, etc.).
 * Strictly guarantees ZERO fallback to delivery boys, patients, or distributors.
 */
export async function getPharmacyOwnerPhone(dbInstance?: any): Promise<string> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('owner_whatsapp_number', 'admin_whatsapp_number', 'admin_whatsapp', 'shop_phone', 'store_phone', 'pharmacy_phone', 'phone') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
       ORDER BY CASE key 
         WHEN 'owner_whatsapp_number' THEN 1
         WHEN 'admin_whatsapp_number' THEN 2
         WHEN 'admin_whatsapp' THEN 3
         WHEN 'shop_phone' THEN 4 
         WHEN 'store_phone' THEN 5 
         WHEN 'pharmacy_phone' THEN 6
         ELSE 7 END 
       LIMIT 1`
    );

    if (row && row.value && row.value.trim()) {
      return row.value.trim();
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving pharmacy owner phone:', err);
  }
  return '';
}

/**
 * Resolves the recipient phone number(s) for email arrival & invoice notifications based on user setting:
 * 'both' | 'store' | 'owner' | 'none'
 */
export async function getInvoiceWhatsAppRecipients(dbInstance?: any): Promise<string[]> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    
    // Check if notifications are disabled overall
    const toggleRow = await db.get("SELECT value FROM app_settings WHERE key = 'notify_owner_on_email_whatsapp'");
    if (toggleRow && (toggleRow.value === '0' || toggleRow.value === 'false')) {
      return [];
    }

    const recipientRow = await db.get("SELECT value FROM app_settings WHERE key = 'email_invoice_whatsapp_recipient'");
    const mode = (recipientRow?.value || 'both').toLowerCase().trim();

    if (mode === 'none') {
      return [];
    }

    const storePhone = await getStorePhone(db);
    const ownerPhone = await getPharmacyOwnerPhone(db);

    const recipients: string[] = [];

    if (mode === 'store' || mode === 'pharmacy') {
      if (storePhone) recipients.push(storePhone);
    } else if (mode === 'owner') {
      if (ownerPhone) recipients.push(ownerPhone);
    } else {
      // 'both' (default)
      if (storePhone) recipients.push(storePhone);
      if (ownerPhone && !recipients.includes(ownerPhone)) {
        recipients.push(ownerPhone);
      }
    }

    // Safeguard fallback: If the chosen specific recipient is not configured in DB, try the other phone
    if (recipients.length === 0) {
      if (storePhone) recipients.push(storePhone);
      else if (ownerPhone) recipients.push(ownerPhone);
    }

    return recipients;
  } catch (err) {
    console.warn('[StoreSettings] Error resolving invoice WhatsApp recipients:', err);
    return [];
  }
}


/**
 * Returns formatted store name with phone if available (e.g. "TANMANY MEDICAL (Ph: 9876543210)" or "TANMANY MEDICAL").
 */
export async function getStoreMedicalNameAndPhone(dbInstance?: any, storeId?: number): Promise<string> {
  const name = await getStoreMedicalName(dbInstance, storeId);
  const phone = await getStorePhone(dbInstance, storeId);
  if (phone) {
    return `${name} (Ph: ${phone})`;
  }
  return name;
}

/**
 * Resolves the configured email retention limit from app_settings (default: 15).
 */
export async function getEmailRetentionLimit(dbInstance?: any): Promise<number> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'email_retention_limit'");
    if (row && row.value && !isNaN(parseInt(row.value, 10))) {
      const val = parseInt(row.value, 10);
      if (val > 0) return val;
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving email retention limit:', err);
  }
  return 15;
}

/**
 * Resolves the configured email retention days from app_settings (default: 14 days).
 * All emails (including saved/processed ones) older than this limit are auto-pruned.
 */
export async function getEmailRetentionDays(dbInstance?: any): Promise<number> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'email_retention_days'");
    if (row && row.value && !isNaN(parseInt(row.value, 10))) {
      const val = parseInt(row.value, 10);
      if (val > 0) return val;
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving email retention days:', err);
  }
  return 14;
}

/**
 * Resolves the configured Google Maps store location / directions link from app_settings.
 */
export async function getStoreGoogleMapsUrl(dbInstance?: any): Promise<string> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get(
      `SELECT value FROM app_settings 
       WHERE key IN ('google_maps_url', 'store_map_link', 'maps_url', 'google_map_url') 
         AND value IS NOT NULL 
         AND TRIM(value) != '' 
       ORDER BY CASE key 
         WHEN 'google_maps_url' THEN 1 
         WHEN 'store_map_link' THEN 2 
         WHEN 'maps_url' THEN 3 
         ELSE 4 END 
       LIMIT 1`
    );
    if (row && row.value && row.value.trim()) {
      return row.value.trim();
    }
  } catch (err) {
    console.warn('[StoreSettings] Error resolving Google Maps URL:', err);
  }
  return '';
}

/**
 * Formats standard customer notification message for ready/fulfilled special order.
 */
export async function buildOrderReadyNotificationMessage(
  requesterName: string,
  productName: string,
  qty: number | string = 1,
  dbInstance?: any,
  lang: string = 'en'
): Promise<string> {
  const storeName = await getStoreMedicalName(dbInstance);
  const storePhone = await getStorePhone(dbInstance);
  const mapUrl = await getStoreGoogleMapsUrl(dbInstance);
  const name = formatCustomerName(requesterName);
  const phone = storePhone ? storePhone.trim() : '';

  if (lang === 'hi') {
    let msg = `नमस्ते ${name}, 👋\n\nखुशखबरी! 🎉 आपकी मांगी गई दवाई ${storeName} पर लेने के लिए तैयार है।\n\nआपका ऑर्डर:\n• ${productName} × ${qty || 1}\n\n`;
    if (mapUrl) {
      msg += `🗺️ दुकान का पता और मैप डायरेक्शन: ${mapUrl}\n\n`;
    } else {
      msg += `📍 कृपया अपनी सुविधानुसार हमारी दुकान पर आकर अपनी दवाई प्राप्त करें।\n\n`;
    }
    if (phone) {
      msg += `📞 सहायता के लिए, हमें ${phone} पर कॉल करें।\n\n`;
    }
    msg += `${storeName} को चुनने के लिए धन्यवाद!`;
    return msg.trim();
  }

  if (lang === 'mr') {
    let msg = `नमस्कार ${name}, 👋\n\nआनंदाची बातमी! 🎉 आपली मागवलेली औषध ${storeName} येथे मिळण्यास तयार आहे.\n\nआपली ऑर्डर:\n• ${productName} × ${qty || 1}\n\n`;
    if (mapUrl) {
      msg += `🗺️ दुकानाचा पत्ता आणि मॅप डायरेक्शन: ${mapUrl}\n\n`;
    } else {
      msg += `📍 कृपया आपल्या सोयीनुसार आमच्या दुकानाला भेट देऊन औषध घेऊन जावे।\n\n`;
    }
    if (phone) {
      msg += `📞 मदतीसाठी, आम्हाला ${phone} वर कॉल करा.\n\n`;
    }
    msg += `${storeName} ची निवड केल्याबद्दल धन्यवाद!`;
    return msg.trim();
  }

  let msg = `Hi ${name}, 👋\n\nGreat news! 🎉 Your requested medicine is now ready for pickup at ${storeName}.\n\nYour Order:\n• ${productName} × ${qty || 1}\n\n`;
  if (mapUrl) {
    msg += `🗺️ Store Location & Directions: ${mapUrl}\n\n`;
  } else {
    msg += `📍 Please visit our store at your convenience to collect your medicine.\n\n`;
  }
  
  if (phone) {
    msg += `📞 For any assistance, call us at ${phone}.\n\n`;
  }
  
  msg += `Thank you for choosing ${storeName}!`;
  return msg.trim();
}

export interface MultiOrderItemArrival {
  productName: string;
  qty: number | string;
  status: 'arrived' | 'delayed';
  delayReason?: string;
  expectedDate?: string;
}

/**
 * Formats a consolidated customer notification message for multiple special orders
 * clearly distinguishing arrived/ready medicines from delayed items.
 */
export async function buildMultiOrderNotificationMessage(
  requesterName: string,
  items: MultiOrderItemArrival[],
  dbInstance?: any,
  lang: string = 'en'
): Promise<string> {
  const storeName = await getStoreMedicalName(dbInstance);
  const storePhone = await getStorePhone(dbInstance);
  const mapUrl = await getStoreGoogleMapsUrl(dbInstance);
  const name = formatCustomerName(requesterName);
  const phone = storePhone ? storePhone.trim() : '';

  const arrivedItems = items.filter(i => i.status === 'arrived');
  const delayedItems = items.filter(i => i.status === 'delayed');

  if (lang === 'hi') {
    let msg = `नमस्ते ${name}, 👋\n\n`;
    if (arrivedItems.length > 0 && delayedItems.length === 0) {
      msg += `खुशखबरी! 🎉 आपकी मांगी गई दवाइयां ${storeName} पर लेने के लिए तैयार हैं:\n\n`;
      msg += `📦 तैयार दवाइयां:\n` + arrivedItems.map(i => `• ${i.productName} × ${i.qty || 1}`).join('\n');
      if (mapUrl) {
        msg += `\n\n🗺️ दुकान का पता और मैप डायरेक्शन: ${mapUrl}`;
      } else {
        msg += `\n\n📍 कृपया अपनी सुविधानुसार हमारी दुकान पर आकर अपनी दवाइयां प्राप्त करें।`;
      }
    } else if (arrivedItems.length > 0 && delayedItems.length > 0) {
      msg += `आपके ऑर्डर का अपडेट (${storeName}):\n\n`;
      msg += `✅ तैयार दवाइयां (दुकान से प्राप्त करें):\n` + arrivedItems.map(i => `• ${i.productName} × ${i.qty || 1}`).join('\n');
      msg += `\n\n⏳ आने में थोड़ा समय (आते ही सूचित करेंगे):\n` + delayedItems.map(i => `• ${i.productName} × ${i.qty || 1}${i.expectedDate ? ` (अपेक्षित: ${i.expectedDate})` : ''}${i.delayReason ? ` - ${i.delayReason}` : ''}`).join('\n');
      if (mapUrl) {
        msg += `\n\n🗺️ दुकान का पता और मैप डायरेक्शन: ${mapUrl}`;
      } else {
        msg += `\n\n📍 तैयार दवाइयां आप दुकान से कभी भी ले सकते हैं। बाकी दवाइयां पहुंचते ही हम तुरंत सूचित करेंगे!`;
      }
    } else {
      msg += `आपके ऑर्डर का अपडेट (${storeName}):\n\n`;
      msg += `⏳ निम्नलिखित दवाइयों में थोड़ा समय लग रहा है:\n` + delayedItems.map(i => `• ${i.productName} × ${i.qty || 1}${i.expectedDate ? ` (अपेक्षित: ${i.expectedDate})` : ''}${i.delayReason ? ` - ${i.delayReason}` : ''}`).join('\n');
      msg += `\n\nहम जल्द से जल्द व्यवस्था कर रहे हैं और आते ही तुरंत सूचित करेंगे।`;
    }

    if (phone) msg += `\n\n📞 सहायता के लिए कॉल करें: ${phone}`;
    msg += `\n\n${storeName} को चुनने के लिए धन्यवाद!`;
    return msg;
  }

  // Default English (also covers other locales cleanly)
  let msg = `Hi ${name}, 👋\n\n`;
  if (arrivedItems.length > 0 && delayedItems.length === 0) {
    msg += `Great news! 🎉 Your requested medicines are now ready for pickup at ${storeName}:\n\n`;
    msg += `📦 Ready for Pickup:\n` + arrivedItems.map(i => `• ${i.productName} × ${i.qty || 1}`).join('\n');
    if (mapUrl) {
      msg += `\n\n🗺️ Store Location & Directions: ${mapUrl}`;
    } else {
      msg += `\n\n📍 Please visit our store at your convenience to collect your medicines.`;
    }
  } else if (arrivedItems.length > 0 && delayedItems.length > 0) {
    msg += `Order status update from ${storeName}:\n\n`;
    msg += `✅ Ready for Pickup:\n` + arrivedItems.map(i => `• ${i.productName} × ${i.qty || 1}`).join('\n');
    msg += `\n\n⏳ Slightly Delayed / In Transit:\n` + delayedItems.map(i => `• ${i.productName} × ${i.qty || 1}${i.expectedDate ? ` (Exp: ${i.expectedDate})` : ''}${i.delayReason ? ` - ${i.delayReason}` : ''}`).join('\n');
    if (mapUrl) {
      msg += `\n\n🗺️ Store Location & Directions: ${mapUrl}`;
    } else {
      msg += `\n\n📍 You can collect the ready medicines anytime. We will notify you as soon as the rest arrive!`;
    }
  } else {
    msg += `Order status update from ${storeName}:\n\n`;
    msg += `⏳ The following medicines are slightly delayed:\n` + delayedItems.map(i => `• ${i.productName} × ${i.qty || 1}${i.expectedDate ? ` (Exp: ${i.expectedDate})` : ''}${i.delayReason ? ` - ${i.delayReason}` : ''}`).join('\n');
    msg += `\n\nWe are actively arranging them and will notify you immediately once received.`;
  }

  if (phone) msg += `\n\n📞 For questions or home delivery, call: ${phone}`;
  msg += `\n\nThank you for choosing ${storeName}!`;
  return msg;
}

/**
 * Returns the configured pharmacy store hours and weekly off days.
 */
export async function getPharmacyOperatingSchedule(dbInstance?: any): Promise<{
  openTime: string;
  closeTime: string;
  weeklyOff: string;
  closedDates: string[];
}> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const rows = await db.all(
      `SELECT key, value FROM app_settings 
       WHERE key IN ('pharmacy_open_time', 'pharmacy_close_time', 'pharmacy_weekly_off', 'pharmacy_closed_dates')`
    );
    const map = new Map<string, string>(rows.map((r: any) => [String(r.key), String(r.value)]));
    let closedDates: string[] = [];
    try {
      const rawDates = map.get('pharmacy_closed_dates');
      if (rawDates) {
        closedDates = JSON.parse(rawDates);
      }
    } catch {}

    return {
      openTime: map.get('pharmacy_open_time') || '09:00',
      closeTime: map.get('pharmacy_close_time') || '22:00',
      weeklyOff: map.get('pharmacy_weekly_off') || 'Monday',
      closedDates: Array.isArray(closedDates) ? closedDates : []
    };
  } catch (err) {
    console.warn('[StoreSettings] Failed to fetch operating schedule:', err);
    return {
      openTime: '09:00',
      closeTime: '22:00',
      weeklyOff: 'Monday',
      closedDates: []
    };
  }
}

/**
 * Persists the pharmacy store hours and weekly off days to app_settings.
 */
export async function savePharmacyOperatingSchedule(
  schedule: {
    openTime?: string;
    closeTime?: string;
    weeklyOff?: string;
    closedDates?: string[];
  },
  dbInstance?: any
): Promise<void> {
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const stmt = await db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
    try {
      if (schedule.openTime !== undefined) {
        await stmt.run(['pharmacy_open_time', schedule.openTime]);
      }
      if (schedule.closeTime !== undefined) {
        await stmt.run(['pharmacy_close_time', schedule.closeTime]);
      }
      if (schedule.weeklyOff !== undefined) {
        await stmt.run(['pharmacy_weekly_off', schedule.weeklyOff]);
      }
      if (schedule.closedDates !== undefined) {
        await stmt.run(['pharmacy_closed_dates', JSON.stringify(schedule.closedDates)]);
      }
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    console.warn('[StoreSettings] Failed to save operating schedule:', err);
    throw err;
  }
}
