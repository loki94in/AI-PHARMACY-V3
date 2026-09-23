// OCR scan queue — max 2 concurrent jobs, deduplicates by message ID.
import { aiCameraService } from './aiCameraService.js';
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';

interface QueueItem {
  msgId: string;
  buffer: Buffer;
  meta: { phone: string; chatId: string; messageBody?: string; imagePath?: string };
}

const queue: QueueItem[] = [];
const processing = new Set<string>();
const done = new Set<string>();
const MAX_CONCURRENT = 2;

function processNext(): void {
  while (processing.size < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift();
    if (!item || processing.has(item.msgId) || done.has(item.msgId)) continue;
    processing.add(item.msgId);

    runScan(item).finally(() => {
      processing.delete(item.msgId);
      done.add(item.msgId);
      processNext();
    });
  }
}

async function runScan(item: QueueItem): Promise<void> {
  try {
    const displayMsgId = typeof item.msgId === 'object' && item.msgId !== null
      ? ((item.msgId as any)._serialized || (item.msgId as any).id || String(item.msgId))
      : String(item.msgId);
    console.log(`[OCR Queue] Scanning message ${displayMsgId} from ${item.meta.phone}`);
    const result = await aiCameraService.processImage(item.buffer, true /* skipEnrichment */, true /* offlineOnly */);

    // If prescription detected, run unified prescription orchestrator to populate prescription_scans & items
    if (result && result.isPrescription) {
      try {
        const { prescriptionOrchestratorService } = await import('./prescriptionOrchestratorService.js');
        const rxScan = await prescriptionOrchestratorService.scanPrescriptionImage({
          buffer: item.buffer,
          source: 'whatsapp',
          msgId: item.msgId,
          imagePath: item.meta.imagePath
        });
        if (rxScan?.scanId) {
          result.prescriptionScanId = rxScan.scanId;
          result.prescriptionItems = rxScan.items;
        }
      } catch (rxErr) {
        console.warn('[OCR Queue] Prescription orchestrator run note:', rxErr);
      }
    }

    // Cache result in scanned_messages table
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT OR REPLACE INTO scanned_messages (msg_id, chat_id, result_json, scanned_at) VALUES (?, ?, ?, ?)',
      [item.msgId, item.meta.chatId, JSON.stringify(result), new Date().toISOString()]
    );

    // Broadcast to admin UI
    const scanPayload = {
      msgId: item.msgId,
      phone: item.meta.phone,
      chatId: item.meta.chatId,
      messageBody: item.meta.messageBody,
      imagePath: item.meta.imagePath,
      ocrResult: result
    };
    eventService.broadcast('ocr_scan_complete', scanPayload);

    // Directly trigger handleOcrComplete so intent matching & catalog lookup always run
    try {
      const { handleOcrComplete } = await import('./whatsappIntentService.js');
      handleOcrComplete(scanPayload);
    } catch (ocrErr) {
      console.warn('[OCR Queue] Direct handleOcrComplete invocation failed:', ocrErr);
    }

    console.log(`[OCR Queue] Scan complete for ${item.msgId}: "${result?.text?.substring(0, 60)}..."`);
  } catch (err) {
    console.error(`[OCR Queue] Scan failed for ${item.msgId}:`, err);
    try {
      const { handleOcrComplete } = await import('./whatsappIntentService.js');
      handleOcrComplete({
        msgId: item.msgId,
        phone: item.meta.phone,
        chatId: item.meta.chatId,
        messageBody: item.meta.messageBody,
        imagePath: item.meta.imagePath,
        ocrResult: { text: '', medicineInfo: null, isPrescription: false, error: err instanceof Error ? err.message : String(err) }
      });
    } catch (_) {}
  }
}

/**
 * Enqueue an image for OCR scanning. Skips if already queued or done.
 */
export function enqueue(msgId: string, buffer: Buffer, meta: { phone: string; chatId: string; messageBody?: string; imagePath?: string }): void {
  if (done.has(msgId) || processing.has(msgId) || queue.some(q => q.msgId === msgId)) {
    return; // Already handled
  }
  queue.push({ msgId, buffer, meta });

  // Immediately acknowledge receipt — fire-and-forget, never blocks OCR
  import('../whatsappClient.js').then(({ sendMessage }) => {
    sendMessage(
      meta.phone,
      undefined,
      '📷 We have received your image and are processing it. Please wait a moment...'
    ).catch(() => {/* silent — ack failure must never crash the OCR pipeline */});
  }).catch(() => {});

  processNext();
}

/**
 * Get cached scan result for a message ID, or null if not scanned.
 */
export async function getCachedResult(msgId: string): Promise<any | null> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT result_json FROM scanned_messages WHERE msg_id = ?', [msgId]);
    if (row?.result_json) {
      return JSON.parse(row.result_json);
    }
  } catch (err) {
    console.error('[OCR Queue] Failed to read cached result:', err);
  }
  return null;
}

export const ocrScanQueue = { enqueue, getCachedResult };
