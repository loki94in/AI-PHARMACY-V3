import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { eventService } from './services/eventService.js';
import { dbManager } from './database/connection.js';
import { config as appConfig, getAppDataDir } from './config/index.js';
import { whatsappBusinessService } from './services/whatsappBusinessService.js';
import { cleanProfileLockFiles } from './services/tokenRefreshScheduler.js';

// whatsapp-web.js uses CommonJS default export, so Client is a value not a type.
// Use InstanceType<typeof Client> to get the correct instance type.
type WAClient = InstanceType<typeof Client>;

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(getAppDataDir(), 'uploads');
// Env override lets tests (and portable installs) point at an isolated auth dir so a
// developer's REAL saved session can never be loaded or wiped by non-app processes.
const WWEBJS_AUTH_DIR = process.env.WWEBJS_AUTH_DIR
  ? path.resolve(process.env.WWEBJS_AUTH_DIR)
  : path.resolve(getAppDataDir(), '.wwebjs_auth');

/** Helper to check if an authenticated WhatsApp session folder exists on disk */
export function hasSavedSession(): boolean {
  const sessionPath = path.join(WWEBJS_AUTH_DIR, 'session');
  if (!fs.existsSync(sessionPath)) return false;
  try {
    const defaultDir = path.join(sessionPath, 'Default');
    const targetDir = fs.existsSync(defaultDir) ? defaultDir : sessionPath;
    const files = fs.readdirSync(targetDir);
    // Ignore transient lock files and devtools port files so partial/cleaned dirs aren't treated as valid sessions
    const meaningfulFiles = files.filter(
      f => !/^(devtoolsactiveport|singleton|lock|\.lock|lockfile)$/i.test(f)
    );
    return meaningfulFiles.length > 0;
  } catch {
    return false;
  }
}

/**
 * Checks whether the user had an active authenticated WhatsApp session in the last session
 * and auto-reconnection is allowed.
 * Gating Rule: If the user never connected or explicitly logged out / disconnected,
 * the app must NEVER autonomously attempt connection or launch Chrome.
 *
 * Strict requirement (ponytail): BOTH conditions must be true:
 *   1. A valid session folder exists on disk (hasSavedSession)
 *   2. whatsapp_session_authenticated = 'true' is explicitly stored in app_settings
 * The legacy phone-number fallback is intentionally removed — it caused Chrome to
 * spawn on boot for installs where WhatsApp was previously paired but later disconnected.
 */
export async function isWhatsAppAutoConnectAllowed(): Promise<boolean> {
  if (await isWhatsAppExplicitlyDisabled()) return false;
  if (!hasSavedSession()) return false;

  try {
    const db = await dbManager.getConnection();
    const authRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_session_authenticated'");
    // Must be an explicit 'true' — missing key or 'false' both block auto-connect
    return authRow?.value === 'true';
  } catch (err) {
    console.error('[WhatsApp] Failed to query session authentication status:', err);
  }

  return false;
}

/** Recursively removes a directory with file attribute resets to avoid EPERM on Windows */
function safeRemoveDirectorySync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (err: any) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        try {
          fs.chmodSync(fullPath, 0o666);
        } catch {}
        if (entry.isDirectory()) {
          safeRemoveDirectorySync(fullPath);
        } else {
          try {
            fs.unlinkSync(fullPath);
          } catch {}
        }
      }
      try {
        fs.rmdirSync(dirPath);
      } catch {}
    } catch {}
  }
}

/** Helper to detect Puppeteer detached frame or destroyed context errors */
export function isPuppeteerDetachedError(msg?: string): boolean {
  if (!msg) return false;
  const str = String(msg);
  return (
    str.includes('detached Frame') ||
    str.includes('Navigating frame was detached') ||
    str.includes('LifecycleWatcher') ||
    str.includes('ECONNREFUSED') ||
    str.includes('Execution context was destroyed') ||
    str.includes('Session closed') ||
    str.includes('Target closed') ||
    str.includes('Protocol error') ||
    str.includes('Page crashed') ||
    str.includes('browser has disconnected') ||
    str.includes('CdpFrame') ||
    str.includes('CdpPage')
  );
}

// Catch and ignore Puppeteer/whatsapp-web.js internal detached frame and context
// destroyed rejections so they don't crash the server process in dev or production.
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || String(reason);
  if (isPuppeteerDetachedError(msg)) {
    console.warn('[WhatsApp SafeGuard] Handled internal Puppeteer/WA rejection & resetting state:', msg);
    isReady = false;
    clientInstance = null;
    if (activeClient) {
      activeClient.destroy().catch(() => {});
      activeClient = null;
    }
    return;
  }
  console.error('[Unhandled Rejection]', reason);
});

export type WhatsAppLifecycleStage =
  | 'sleeping'
  | 'waking'
  | 'connecting'
  | 'syncing'
  | 'ready'
  | 'disconnected'
  | 'failed';

export interface WhatsAppReadinessState {
  isReady: boolean;
  isSleeping: boolean;
  isInitializing: boolean;
  progress: number; // 0 to 100
  stage: WhatsAppLifecycleStage;
  status: string;
  lastError: string | null;
  hasSavedSession: boolean;
}

let currentLifecycleStage: WhatsAppLifecycleStage = 'disconnected';
let currentLifecycleProgress: number = 0;
let currentLifecycleStatusText: string = 'Disconnected';
let lastInitError: string | null = null;

export function setLifecycleProgress(
  stage: WhatsAppLifecycleStage,
  progress: number,
  statusText: string,
  error?: string
): void {
  currentLifecycleStage = stage;
  currentLifecycleProgress = Math.max(0, Math.min(100, Math.round(progress)));
  currentLifecycleStatusText = statusText;
  if (error) {
    lastInitError = error;
  } else if (stage === 'ready') {
    lastInitError = null;
  }

  try {
    eventService.broadcast('wa_readiness_progress', {
      stage,
      progress: currentLifecycleProgress,
      status: statusText,
      isReady: isReady && !!clientInstance,
      isSleeping: isSleeping && !isReady,
      isInitializing: initializing || !!initPromise,
      error: error || null
    });
  } catch (_) {}
}

export function getWhatsAppReadiness(): WhatsAppReadinessState {
  let stage: WhatsAppLifecycleStage = 'disconnected';
  let progress = 0;
  let statusText = 'Disconnected';

  if (isReady && clientInstance) {
    stage = 'ready';
    progress = 100;
    statusText = 'WhatsApp Ready';
  } else if (isSyncing) {
    stage = 'syncing';
    progress = 85;
    statusText = 'Syncing chats & contacts...';
  } else if (initializing || initPromise) {
    stage = currentLifecycleStage || 'connecting';
    progress = currentLifecycleProgress || 50;
    statusText = currentLifecycleStatusText || 'Connecting...';
  } else if (isSleeping) {
    stage = 'sleeping';
    progress = 0;
    statusText = 'Sleeping (auto-wakes on demand)';
  } else if (hasSavedSession()) {
    stage = 'disconnected';
    progress = 0;
    statusText = 'Saved session present (standby)';
  }

  return {
    isReady: isReady && !!clientInstance,
    isSleeping: isSleeping && !isReady,
    isInitializing: initializing || !!initPromise,
    progress,
    stage,
    status: statusText,
    lastError: lastInitError,
    hasSavedSession: hasSavedSession()
  };
}

let clientInstance: WAClient | null = null;
let activeClient: WAClient | null = null; // Track currently initializing or active client
let initPromise: Promise<WAClient | null> | null = null; // Single-flight mutex
let initializing = false;
let isSyncing = false;
let qrTimeout: NodeJS.Timeout | null = null;
let isLoginWindowActive = false; // Mutex flag: true when Chrome login popup is open

export function setLoginWindowActive(active: boolean): void {
  isLoginWindowActive = active;
}

export function isWhatsAppLoginWindowActive(): boolean {
  return isLoginWindowActive;
}
// Timestamp (ms) of the last getChats() failure — suppresses retries for 30 s
let lastSyncFailureAt: number = 0;
let lastSyncCooldownLoggedAt: number = 0;
const SYNC_RETRY_COOLDOWN_MS = 30_000;

// Timestamp (ms) of the last failed initialization — prevents rapid retry storms on locked/broken profiles
let lastInitFailureAt: number = 0;
const INIT_FAILURE_COOLDOWN_MS = 60_000;

// ── Idle sleep (RAM diet, owner decision 2026-08) ─────────────────────────────
// The resident headless Chrome is the app's single biggest steady-state RAM
// consumer (~250–400 MB). All patient messaging is user-clicked (Strict
// Manual-Only contract), so after an idle window we close the browser and let
// demand-driven wake paths re-open it: sendMessage()/getChats() auto-init via
// initClient(), and whatsappQueueWorker's existing 60 s-cooldown silent restore
// wakes it for queued items. Same number, same library, identical ban profile —
// this changes ONLY when Chrome runs, never how WhatsApp is driven.
let waSleepTimer: NodeJS.Timeout | null = null;
let lastWaActivityAt: number = Date.now();
let isSleeping = false;
const WA_SLEEP_EVALUATOR_MS = 60_000;

async function getIdleSleepMinutes(): Promise<number> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_idle_sleep_min'");
    const parsed = row?.value ? parseInt(row.value, 10) : NaN;
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  } catch (_) {}
  return 0;
}

function armSleepEvaluator(delayMs: number = WA_SLEEP_EVALUATOR_MS): void {
  if (waSleepTimer) clearTimeout(waSleepTimer);
  waSleepTimer = setTimeout(() => {
    evaluateIdleSleep().catch(() => {});
  }, delayMs);
}

/** Mark user-, queue-, or sync-driven WhatsApp usage so idle-sleep backs off. */
export function markWhatsAppActivity(): void {
  lastWaActivityAt = Date.now();
  if (!waSleepTimer && clientInstance && isReady) {
    armSleepEvaluator();
  }
}

async function evaluateIdleSleep(): Promise<void> {
  waSleepTimer = null;
  // Evaluator only runs while a browser is resident; it stops itself when none
  // exists (asleep/offline) and the next markWhatsAppActivity() re-arms it.
  if (!isReady || !clientInstance) return;
  const idleMin = await getIdleSleepMinutes();
  if (idleMin <= 0) return; // feature disabled in Settings — stays off until next activity

  // Busy flows: retry shortly instead of sleeping mid-flight.
  if (initPromise || initializing || currentQr || isSyncing) {
    armSleepEvaluator();
    return;
  }

  const idleFor = Date.now() - lastWaActivityAt;
  if (idleFor < idleMin * 60_000) {
    armSleepEvaluator(Math.min(idleMin * 60_000 - idleFor + 1_000, WA_SLEEP_EVALUATOR_MS));
    return;
  }

  console.log(`[WhatsApp] Idle ≥ ${idleMin} min — sleeping WhatsApp browser to free RAM (saved session intact; auto-wakes on demand).`);
  isSleeping = true;
  setLifecycleProgress('sleeping', 0, 'Sleeping to save memory (session saved)');
  try {
    eventService.broadcast('wa_status_changed', {
      status: 'sleeping',
      message: 'WhatsApp sleeping to save memory. It wakes automatically when you send a message.',
      service: 'whatsapp'
    });
  } catch (_) {}
  try {
    await destroyClient();
  } catch (_) {}
}
// ── end idle sleep ────────────────────────────────────────────────────────────

export let currentQr: string | null = null;
export let isReady: boolean = false;

export function setCurrentQr(qr: string | null) {
  currentQr = qr;
}

export function setIsReady(ready: boolean) {
  isReady = ready;
}

/** Check if WhatsApp is explicitly disabled in store settings */
export async function isWhatsAppExplicitlyDisabled(): Promise<boolean> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'");
    if (row && row.value === 'false') return true;
    const prefRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_preferred_system'");
    if (prefRow && prefRow.value === 'disabled') return true;
    return false;
  } catch {
    return false;
  }
}

export async function getWhatsAppStatus() {
  let pendingCount = 0;
  try {
    const db = await dbManager.getConnection();
    const row = await db.get("SELECT COUNT(*) as cnt FROM whatsapp_send_queue WHERE sent_at IS NULL");
    pendingCount = row?.cnt || 0;
  } catch (_) {}
  return {
    isReady,
    initializing: initializing || !!initPromise,
    isSyncing,
    pendingQueueCount: pendingCount,
    hasQr: !!currentQr,
    sleeping: isSleeping && !isReady,
    readiness: getWhatsAppReadiness()
  };
}

/**
 * Bounded wait for the personal WhatsApp client to become ready — used by background
 * alert senders (email arrival, distributor invoice alerts) that can fire during the
 * boot session-restore window. Reuses the single-flight init when a saved session
 * exists instead of failing immediately with "session is not connected".
 * Returns true once ready; false on timeout, disabled WhatsApp, missing saved session,
 * or when routing goes through the Business API (personal readiness irrelevant there).
 */
export async function waitForWhatsAppReady(timeoutMs: number = 90_000): Promise<boolean> {
  if (await shouldRouteToBusiness()) return true;
  if (await isWhatsAppExplicitlyDisabled()) return false;
  if (!(await isWhatsAppAutoConnectAllowed())) return false;
  const deadline = Date.now() + timeoutMs;
  let lastKick = 0;
  while (Date.now() < deadline) {
    if (isReady && clientInstance) return true;
    const now = Date.now();
    // Re-kick a failed/silent init at most every 20s within our own budget —
    // never tight-loop Chrome launches.
    if (!initializing && !initPromise && now - lastKick > 20_000) {
      lastKick = now;
      initClient({ manual: true }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  return !!(isReady && clientInstance);
}

/**
 * Ensures WhatsApp is warmed up and ready before scheduled batch triggers execute.
 * If WhatsApp is sleeping, triggers silent session restore and awaits ready state.
 */
export async function ensureWhatsAppReady(timeoutMs: number = 30_000): Promise<boolean> {
  markWhatsAppActivity();
  return waitForWhatsAppReady(timeoutMs);
}

/**
 * Verifies session health when idle for >= 15 min.
 * If WhatsApp Web is stalled or desynced, re-probes or refreshes to guarantee delivery.
 */
export async function ensureSessionHealth(): Promise<boolean> {
  if (!isReady || !clientInstance) return false;
  const idleMin = (Date.now() - lastWaActivityAt) / 60_000;
  if (idleMin >= 15) {
    console.log(`[WhatsApp Health] Session idle for ${Math.round(idleMin)}m. Running health probe...`);
    try {
      const state = await (clientInstance as any).getState?.().catch(() => null);
      if (state && state !== 'CONNECTED') {
        console.warn(`[WhatsApp Health] Non-connected state (${state}). Refreshing WhatsApp page...`);
        if (clientInstance.pupPage && !clientInstance.pupPage.isClosed()) {
          await clientInstance.pupPage.reload({ waitUntil: 'networkidle0', timeout: 30_000 }).catch(() => {});
        }
      }
    } catch (e: any) {
      console.warn('[WhatsApp Health] Health probe note:', e?.message);
    }
  }
  return true;
}

/** Helper to check whether we should route messages to WhatsApp Business Cloud API */
export async function shouldRouteToBusiness(): Promise<boolean> {
  const db = await dbManager.getConnection();

  // First, check preferred system
  const preferredSystemRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_preferred_system'");
  if (preferredSystemRow) {
    if (preferredSystemRow.value === 'official') return true;
    if (preferredSystemRow.value === 'automated') return false;
  }

  // Fallback to wa_business_enabled
  const row = await db.get("SELECT value FROM app_settings WHERE key = 'wa_business_enabled'");
  if (row) {
    return row.value === 'true';
  }

  // Default to automated mode (use the scanned in-app WhatsApp Web session headlessly)
  return false;
}

/**
 * Kill stale Chrome/Edge processes and remove lock files holding the wwebjs session profile.
 *
 * Uses async exec (not execSync) with a hard timeout: the underlying WMI query
 * (Get-CimInstance) is known to stall for many seconds — occasionally longer —
 * on real machines (corrupted WMI repo, AV interference, slow disks). This runs
 * on every WhatsApp init, including the automatic one on server boot whenever a
 * session was already linked, so a synchronous hang here used to freeze the
 * entire single-process app, not just WhatsApp.
 */
async function cleanupProfileLocks(): Promise<void> {
  const sessionPath = path.join(WWEBJS_AUTH_DIR, 'session');

  if (process.platform === 'win32') {
    try {
      const filterPattern = sessionPath.replace(/\\/g, '*').replace(/\//g, '*');
      const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe' or name = 'msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${filterPattern}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`;
      await execAsync(cmd, { timeout: 8000 });
      console.log('[WhatsApp Init] Stale WhatsApp browser processes terminated.');
    } catch (err: any) {
      // Includes timeout kills (ETIMEDOUT/SIGTERM) — non-fatal either way, WA init proceeds.
      console.warn('[WhatsApp Init] Could not check/kill running browser processes (non-fatal):', err.message);
    }
  }

  // Delegate to the canonical lock-file cleanup (tokenRefreshScheduler.ts) — its 7-file
  // list is a superset of the 3 this used to clean locally, so nothing is lost.
  cleanProfileLockFiles(sessionPath);
}

/** Shared ignore-check used by the message_create handler (mirrors whatsappIntentService's own copy, used for the raw client event path). */
async function isChatIgnored(db: any, chatId: string): Promise<boolean> {
  const phone = chatId.split('@')[0];
  const row = await db.get(
    `SELECT reason FROM ignored_whatsapp_numbers WHERE phone = ? OR phone = ? LIMIT 1`,
    [chatId, phone]
  );
  if (row) {
    return row.reason !== 'unignored';
  }
  const isGroupOrBroadcast = chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.includes('broadcast') || chatId === 'status@broadcast' || chatId.includes('-');
  if (isGroupOrBroadcast) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO ignored_whatsapp_numbers (phone, reason) VALUES (?, ?)`,
        [chatId, chatId.endsWith('@g.us') ? 'group' : 'broadcast']
      );
    } catch (e) {
      console.warn('[WhatsApp] Failed to auto-insert ignored chat:', e);
    }
  }
  return isGroupOrBroadcast;
}

/** Asynchronously sync chats and recent messages from WhatsApp to SQLite (fired on 'ready' and opportunistically). */
async function syncWhatsappData(client: WAClient) {
  if (isSyncing) {
    console.log('[WhatsApp] Synchronization already in progress, skipping duplicate request.');
    return;
  }

  // Cooldown: if getChats() failed recently, skip to avoid rapid error loops
  const now = Date.now();
  if (lastSyncFailureAt > 0 && (now - lastSyncFailureAt) < SYNC_RETRY_COOLDOWN_MS) {
    const retryInSec = Math.ceil((SYNC_RETRY_COOLDOWN_MS - (now - lastSyncFailureAt)) / 1000);
    // Rate-limit the cooldown log so it only logs once per cooldown window instead of spamming on every event
    if (now - lastSyncCooldownLoggedAt > 15_000) {
      lastSyncCooldownLoggedAt = now;
      console.log(`[WhatsApp] Sync skipped — cooldown active. Retry in ${retryInSec}s.`);
    }
    return;
  }

  isSyncing = true;
  try {
    console.log('[WhatsApp] Starting background synchronization of chats and messages...');
    let chats: any[];
    try {
      chats = await client.getChats();
    } catch (getChatsErr: any) {
      const errMsg = getChatsErr?.message || String(getChatsErr);
      
      // If store is still hydrating, wait dynamically for store readiness and retry once
      if (errMsg === 'r' || errMsg.includes('Evaluation failed')) {
        const storeReady = await waitForChatStoreReady(client, 6000);
        if (storeReady) {
          try {
            chats = await client.getChats();
          } catch (retryErr: any) {
            lastSyncFailureAt = Date.now();
            console.log('[WhatsApp] Chat sync deferred to next cycle.');
            return;
          }
        } else {
          lastSyncFailureAt = Date.now();
          console.log('[WhatsApp] Chat sync deferred to next cycle.');
          return;
        }
      } else {
        lastSyncFailureAt = Date.now();
        console.warn(`[WhatsApp] getChats() deferred (will retry after ${SYNC_RETRY_COOLDOWN_MS / 1000}s):`, errMsg);
        if (isPuppeteerDetachedError(errMsg)) {
          console.warn('[WhatsApp] Sync hit detached Frame/browser context. Invalidating client state...');
          isReady = false;
          clientInstance = null;
          if (activeClient) {
            activeClient.destroy().catch(() => {});
            activeClient = null;
          }
        }
        return;
      }
    }
    const db = await dbManager.getConnection();

    const ignoreRows = await db.all('SELECT phone, reason FROM ignored_whatsapp_numbers');
    const ignoreMap = new Map<string, string>();
    for (const r of ignoreRows) {
      ignoreMap.set(r.phone, r.reason);
    }

    const isIgnoredCached = async (chatId: string) => {
      const phone = chatId.split('@')[0];
      const explicit = ignoreMap.get(chatId) || ignoreMap.get(phone);
      if (explicit !== undefined) {
        return explicit !== 'unignored';
      }
      const isGroupOrBroadcast = chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.includes('broadcast') || chatId === 'status@broadcast' || chatId.includes('-');
      if (isGroupOrBroadcast) {
        try {
          await db.run(
            `INSERT OR IGNORE INTO ignored_whatsapp_numbers (phone, reason) VALUES (?, ?)`,
            [chatId, chatId.endsWith('@g.us') ? 'group' : 'broadcast']
          );
          ignoreMap.set(chatId, chatId.endsWith('@g.us') ? 'group' : 'broadcast');
        } catch (e) {
          console.warn('[WhatsApp] Failed to auto-insert ignored chat in sync:', e);
        }
      }
      return isGroupOrBroadcast;
    };

    for (const chat of chats) {
      const chatId = chat.id._serialized;
      if (await isIgnoredCached(chatId)) {
        continue;
      }
      const lastMsg = chat.lastMessage ? chat.lastMessage.body : null;

      let resolvedNumber = chatId.split('@')[0];
      if (chatId.endsWith('@lid')) {
        try {
          const mapping = await client.getContactLidAndPhone([chatId]);
          if (mapping && mapping[0] && mapping[0].pn) {
            resolvedNumber = mapping[0].pn;
          } else {
            const contact = await client.getContactById(chatId);
            if (contact && contact.number && contact.number !== resolvedNumber) {
              resolvedNumber = contact.number;
            }
          }
        } catch (e) {
          console.error(`[WhatsApp] Failed to resolve LID ${chatId}:`, e);
        }
      }

      await db.run(
        `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           unread_count=excluded.unread_count,
           timestamp=excluded.timestamp,
           last_message=excluded.last_message,
           is_group=excluded.is_group,
           resolved_number=excluded.resolved_number`,
        [
          chatId,
          chat.name || chat.id.user,
          chat.unreadCount || 0,
          chat.timestamp || Math.floor(Date.now() / 1000),
          lastMsg,
          chat.isGroup ? 1 : 0,
          resolvedNumber
        ]
      );
    }

    // Process offline unread customer messages: send a friendly reopening greeting
    // so customers who messaged while the store was offline/closed know we are now open,
    // without re-running heavy OCR or triggering auto-order pipeline.
    try {
      const ownerRow = await db.get("SELECT value FROM app_settings WHERE key = 'owner_whatsapp_number'");
      const ownerPhone = (ownerRow?.value || '').replace(/\D/g, '');
      const { getStoreMedicalName } = await import('./services/storeSettingsService.js');
      const storeName = await getStoreMedicalName(db);

      for (const chat of chats) {
        const chatId = chat.id._serialized;
        if (chat.isGroup || (await isIgnoredCached(chatId))) continue;
        if (!chat.unreadCount || chat.unreadCount <= 0) continue;
        if (!chat.lastMessage || chat.lastMessage.fromMe) continue;

        let cleanNumber = chatId.split('@')[0].replace(/\D/g, '');
        if (chatId.endsWith('@lid')) {
          const mapping = await client.getContactLidAndPhone([chatId]).catch(() => null);
          if (mapping?.[0]?.pn) cleanNumber = mapping[0].pn.replace(/\D/g, '');
        }

        if (!cleanNumber || cleanNumber.length < 10) continue;
        if (ownerPhone && cleanNumber.endsWith(ownerPhone.slice(-10))) continue;

        // Avoid re-greeting the same customer within 12 hours
        const recentGreeting = await db.get(
          `SELECT id FROM whatsapp_sent_register 
           WHERE (phone = ? OR phone_last10 = ?) 
             AND type = 'offline_reconnect_greeting' 
             AND sent_at >= ? LIMIT 1`,
          [cleanNumber, cleanNumber.slice(-10), Date.now() - 12 * 60 * 60 * 1000]
        );

        if (!recentGreeting) {
          const greetingMsg = `☀️ *Good Morning from ${storeName}!*\n\nWe are now open. We noticed your message while our systems were offline.\n\nHow can we help you with your medicines or healthcare needs today?`;
          const { whatsappQueueWorker } = await import('./services/whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(
            cleanNumber,
            greetingMsg,
            'offline_reconnect_greeting',
            chat.name || 'Customer'
          );
          console.log(`[WhatsApp Sync] Enqueued offline reopening greeting for ${cleanNumber} (${chat.name || 'Customer'}).`);
        }
      }
    } catch (greetErr) {
      console.warn('[WhatsApp Sync] Failed to process offline reconnect greetings:', greetErr);
    }

    console.log('[WhatsApp] Background synchronization completed successfully.');
    eventService.broadcast('wa_chats_updated', { success: true });
  } catch (err) {
    console.error('[WhatsApp] Error during synchronization:', err);
  } finally {
    isSyncing = false;
  }
}

/**
 * Probes WhatsApp Web's browser page until window.WWebJS and window.Store.Chat
 * are fully injected and ready to serve getChats() calls without throwing 'Evaluation failed'.
 */
export async function waitForChatStoreReady(client: any, maxWaitMs: number = 15000): Promise<boolean> {
  const page = client?.pupPage;
  if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return false;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      if (typeof page.isClosed === 'function' && page.isClosed()) return false;
      const ready = await page.evaluate(() => {
        try {
          const w = window as any;
          return !!(w.Store && w.Store.Chat && w.WWebJS && typeof w.WWebJS.getChats === 'function');
        } catch (_) {
          return false;
        }
      });
      if (ready) return true;
    } catch (_) {
      // Browser context or frame might still be hydrating/navigating
    }
    await new Promise(res => setTimeout(res, 800));
  }
  return false;
}

/**
 * Injects defensive runtime patches into the WhatsApp Web page context:
 * 1. Wraps internal memoized getters (WAWebChatGetters, WAWebContactGetters, WAWebFrontendContactGetters)
 *    so any missing/partial ID returns safe fallback values rather than throwing
 *    "Data passed to getter must include an id property, it's how we memoize".
 * 2. Patches window.WWebJS.getChat to safely resolve chats for unsaved / new contacts
 *    using Chat.get -> Chat.find -> findOrCreateLatestChat -> Chat.add fallback.
 * 3. Patches window.WWebJS.getChatModel and getMessageModel to handle incomplete objects gracefully.
 */
export async function patchWWebJSInternals(pupPage: any): Promise<void> {
  if (!pupPage || pupPage.isClosed()) return;
  try {
    await pupPage.evaluate(() => {
      try {
        // 1. Wrap internal WhatsApp Web getters to neutralize memoizer crashes on unsaved contacts
        const wrapGetterModule = (modName: string, defaultBool = false) => {
          try {
            const mod = (window as any).require?.(modName);
            if (!mod) return;
            for (const key of Object.keys(mod)) {
              if (typeof mod[key] === 'function' && !mod[key].__patchedSafe) {
                const origFn = mod[key];
                const wrapped = function(this: any, ...args: any[]) {
                  try {
                    const first = args[0];
                    if (!first || (!first.id && !first._serialized && !first.user)) {
                      if (key === 'getName' || key === 'getPushname' || key === 'getFormattedTitle') return '';
                      return defaultBool;
                    }
                    return origFn.apply(this, args);
                  } catch (err: any) {
                    if (String(err).includes('id property') || String(err).includes('memoize')) {
                      if (key === 'getName' || key === 'getPushname' || key === 'getFormattedTitle') return '';
                      return defaultBool;
                    }
                    throw err;
                  }
                };
                wrapped.__patchedSafe = true;
                mod[key] = wrapped;
              }
            }
          } catch (_) {}
        };

        wrapGetterModule('WAWebChatGetters', false);
        wrapGetterModule('WAWebContactGetters', false);
        wrapGetterModule('WAWebFrontendContactGetters', true);
        wrapGetterModule('WAWebMsgGetters', false);
        wrapGetterModule('WAWebMediaGetters', false);

        // Global memoize error suppressor: scan Webpack cache for any getter containing "how we memoize" or "id property"
        try {
          const req = (window as any).require;
          const cache = req?.c;
          if (cache) {
            for (const modId of Object.keys(cache)) {
              const modExports = cache[modId]?.exports;
              if (!modExports) continue;
              const targets = [modExports, modExports.default].filter(Boolean);
              for (const t of targets) {
                if (typeof t === 'object') {
                  const propNames = Object.getOwnPropertyNames(t);
                  for (const prop of propNames) {
                    try {
                      const val = t[prop];
                      if (typeof val === 'function' && !val.__memoizePatched) {
                        const str = val.toString();
                        if (str.includes('how we memoize') || str.includes('id property')) {
                          const orig = val;
                          const patched = function(this: any, ...args: any[]) {
                            try {
                              return orig.apply(this, args);
                            } catch (err: any) {
                              if (String(err).includes('id property') || String(err).includes('memoize')) {
                                return undefined;
                              }
                              throw err;
                            }
                          };
                          patched.__memoizePatched = true;
                          try { t[prop] = patched; } catch (_) {}
                        }
                      }
                    } catch (_) {}
                  }
                }
              }
            }
          }
        } catch (_) {}

        // 2. Patch window.WWebJS.getChat to never crash on unsaved / new phone numbers
        if ((window as any).WWebJS && !(window as any).WWebJS.__getChatPatched) {
          (window as any).WWebJS.__getChatPatched = true;
          const origGetChat = (window as any).WWebJS.getChat;
          (window as any).WWebJS.getChat = async function(this: any, chatId: string, opts: any = {}) {
            const isChannel = /@\w*newsletter\b/.test(chatId);
            if (isChannel) {
              return await origGetChat.apply(this, arguments as any);
            }

            const widFactory = (window as any).require?.('WAWebWidFactory');
            const collections = (window as any).require?.('WAWebCollections');
            const findChatAction = (window as any).require?.('WAWebFindChatAction');

            if (!widFactory || !collections?.Chat) {
              return await origGetChat.apply(this, arguments as any);
            }

            let chatWid: any = null;
            try {
              chatWid = widFactory.createWid(chatId);
            } catch (_) {
              return await origGetChat.apply(this, arguments as any);
            }

            let chat = collections.Chat.get(chatWid);

            // Step A1: Search local IndexedDB cache by primary JID
            if (!chat && collections.Chat.find) {
              try {
                chat = await collections.Chat.find(chatWid);
              } catch (_) {}
            }

            // Step A2: Check alternate phone JID mapping (bidirectional @lid <-> @c.us)
            if (!chat) {
              try {
                const apiContact = (window as any).require?.('WAWebApiContact');
                const altWid = apiContact?.getAlternateUserWid?.(chatWid);
                if (altWid) {
                  chat = collections.Chat.get(altWid) || (collections.Chat.find ? await collections.Chat.find(altWid).catch(() => null) : null);
                }
              } catch (_) {}
            }

            // Step B: Attempt native findOrCreateLatestChat with error suppression
            if (!chat && findChatAction?.findOrCreateLatestChat) {
              try {
                const res = await findChatAction.findOrCreateLatestChat(chatWid);
                chat = res?.chat || res;
              } catch (_) {}
            }

            // Step C: Fallback to collection creation if store didn't return a chat
            if (!chat && collections.Chat.add) {
              try {
                const added = collections.Chat.add({ id: chatWid });
                chat = Array.isArray(added) ? added[0] : added;
              } catch (_) {}
            }

            // Step D: If still not found, try original implementation
            if (!chat) {
              try {
                chat = await origGetChat.apply(this, arguments as any);
              } catch (_) {}
            }

            if (opts.getAsModel && chat) {
              return await (window as any).WWebJS.getChatModel(chat, { isChannel: false });
            }
            return chat;
          };
        }

        // 3. Patch window.WWebJS.getChatModel to never throw on missing id/memoize
        if ((window as any).WWebJS && !(window as any).WWebJS.__chatModelPatched) {
          (window as any).WWebJS.__chatModelPatched = true;
          const origGetChatModel = (window as any).WWebJS.getChatModel;
          (window as any).WWebJS.getChatModel = async function(this: any, chat: any, opts: any) {
            try {
              return await origGetChatModel.apply(this, arguments as any);
            } catch (err: any) {
              if (String(err).includes('id property') || String(err).includes('memoize')) {
                const model = typeof chat?.serialize === 'function' ? chat.serialize() : { id: chat?.id };
                model.formattedTitle = chat?.id?._serialized || chat?.id?.user || 'Customer';
                return model;
              }
              throw err;
            }
          };
        }

        // 4. Patch window.WWebJS.getMessageModel to never throw on missing id/memoize
        if ((window as any).WWebJS && !(window as any).WWebJS.__msgModelPatched) {
          (window as any).WWebJS.__msgModelPatched = true;
          const origGetMessageModel = (window as any).WWebJS.getMessageModel;
          (window as any).WWebJS.getMessageModel = function(this: any, message: any) {
            try {
              return origGetMessageModel.apply(this, arguments as any);
            } catch (err: any) {
              if (String(err).includes('id property') || String(err).includes('memoize')) {
                return typeof message?.serialize === 'function' ? message.serialize() : { id: message?.id, body: message?.body };
              }
              throw err;
            }
          };
        }

        // 5. Patch window.WWebJS.sendMessage to ensure chat.contact is attached
        if ((window as any).WWebJS && !(window as any).WWebJS.__sendMsgSafePatched) {
          (window as any).WWebJS.__sendMsgSafePatched = true;
          const origSendMessage = (window as any).WWebJS.sendMessage;
          (window as any).WWebJS.sendMessage = async function(this: any, chat: any, content: any, options: any = {}) {
            try {
              const collections = (window as any).require?.('WAWebCollections');
              if (chat && collections?.Contact) {
                if (!chat.contact && collections.Contact.get) {
                  chat.contact = collections.Contact.get(chat.id);
                }
                if (!chat.contact && collections.Contact.add) {
                  try {
                    const added = collections.Contact.add({ id: chat.id, isWAContact: true });
                    chat.contact = Array.isArray(added) ? added[0] : added;
                  } catch (_) {}
                }
                if (chat.contact && !chat.__x_contact) {
                  chat.__x_contact = chat.contact;
                }
              }
            } catch (_) {}
            return await origSendMessage.apply(this, arguments as any);
          };
        }
      } catch (_) {}
    });
  } catch (_) {}
}

/** Internal helper to instantiate WAClient and bind event listeners */
function launchClientInstance(forceQr: boolean): Promise<WAClient> {
  return new Promise<WAClient>((resolve, reject) => {
    let execPath = '';
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe') : null,
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe') : null
    ].filter(Boolean) as string[];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        execPath = p;
        break;
      }
    }

    const puppeteerArgs = [
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-component-update',
      '--disable-background-networking',
      '--renderer-process-limit=1',
      '--js-flags=--max-old-space-size=256'
    ];

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: WWEBJS_AUTH_DIR }),
      puppeteer: execPath
        ? { executablePath: execPath, headless: true, args: puppeteerArgs }
        : { headless: true, args: puppeteerArgs }
    });
    activeClient = client;

    let qrCount = 0;
    let qrAutoStopTimer: NodeJS.Timeout | null = null;

    // Hard watchdog: on some PCs Puppeteer/Chrome launch can hang indefinitely
    // (browser missing at all 4 hardcoded paths so puppeteer-core has nothing to
    // launch, a corrupted profile, driver/AV interference) without ever emitting
    // 'qr', 'ready', or rejecting initialize(). Without this, `initializing` gets
    // stuck `true` forever and WhatsApp features stay dead until the whole app
    // is restarted. Cleared as soon as any real progress (qr/ready/init failure)
    // is observed — legitimate long QR waits are governed by their own 120s timer.
    const initWatchdog = setTimeout(() => {
      if (clientInstance) return;
      console.error('[WhatsApp] Init watchdog fired — no response from browser within 60s. Resetting.');
      initializing = false;
      isReady = false;
      activeClient = null;
      client.destroy().catch(() => {});
      reject(new Error('WhatsApp client initialization timed out (60s) — Chrome/Edge may be missing or unresponsive.'));
    }, 60_000);
    const clearInitWatchdog = () => clearTimeout(initWatchdog);

    client.on('qr', async (qr: string) => {
      clearInitWatchdog();
      // If user did not explicitly request QR scan (forceQr: false), stop immediately — never leave Chrome open for unsolicited QR
      if (!forceQr) {
        console.log('[WhatsApp] Unsolicited QR event suppressed. Stopping client until explicit user connection in UI.');
        if (qrAutoStopTimer) clearTimeout(qrAutoStopTimer);
        currentQr = null;
        initializing = false;
        isReady = false;
        activeClient = null;
        client.destroy().catch(() => {});
        setLifecycleProgress('disconnected', 0, 'WhatsApp requires QR scan (standby)');
        // Settle the init promise — otherwise every caller (sendMessage, boot auto-init,
        // Settings connect) awaits a promise that never resolves and WA stays dead until restart.
        reject(new Error('WhatsApp session expired or requires QR scan. Connect manually from Settings.'));
        return;
      }

      qrCount++;
      console.log(`[WhatsApp] QR code received (attempt ${qrCount}/5, standing by for scan)...`);
      currentQr = qr;
      isReady = false;
      setLifecycleProgress('connecting', 50, `Standing by for QR scan (attempt ${qrCount}/5)...`);

      if (!qrAutoStopTimer) {
        qrAutoStopTimer = setTimeout(() => {
          console.log('[WhatsApp] QR scan timed out (2 minutes elapsed). Stopping browser process until manual connect.');
          currentQr = null;
          initializing = false;
          isReady = false;
          if (activeClient) {
            activeClient.destroy().catch(() => {});
            activeClient = null;
          }
          clientInstance = null;
          setLifecycleProgress('failed', 0, 'QR scan timed out (2 minutes)', 'QR_TIMEOUT');
          // Settle the init promise so awaiting callers fail fast instead of hanging forever.
          reject(new Error('WhatsApp QR scan timed out (2 minutes). Click Reconnect / Open Live Chrome Window to try again.'));
        }, 120_000);
      }

      if (qrCount >= 5) {
        console.log('[WhatsApp] Reached max QR refresh attempts (5). Auto-stopping browser until manual connect.');
        if (qrAutoStopTimer) clearTimeout(qrAutoStopTimer);
        currentQr = null;
        initializing = false;
        isReady = false;
        activeClient = null;
        client.destroy().catch(() => {});
        setLifecycleProgress('failed', 0, 'Max QR refresh attempts reached', 'MAX_QR_EXCEEDED');
        // Settle the init promise so awaiting callers fail fast instead of hanging forever.
        reject(new Error('WhatsApp QR expired 5 times without being scanned. Reconnect from Settings to try again.'));
      }
    });

    client.on('authenticated', async () => {
      console.log('[WhatsApp] QR scanned & authenticated! Persisting credential status immediately...');
      currentQr = null;
      if (qrTimeout) clearTimeout(qrTimeout);
      if (qrAutoStopTimer) clearTimeout(qrAutoStopTimer);
      setLifecycleProgress('connecting', 80, 'Authenticated! Finalizing session...');
      try {
        const db = await dbManager.getConnection();
        await db.run(
          `INSERT INTO app_settings (key, value) VALUES ('whatsapp_session_authenticated', 'true')
           ON CONFLICT(key) DO UPDATE SET value = 'true'`
        );
        await db.run(
          `INSERT INTO app_settings (key, value) VALUES ('whatsapp_last_connected_at', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [new Date().toISOString()]
        );
      } catch (err) {
        console.warn('[WhatsApp] Failed to write authenticated status on authenticated event:', err);
      }
    });

    client.on('ready', async () => {
      console.log('WhatsApp Client is ready!');
      lastInitFailureAt = 0;
      clearInitWatchdog();
      if (qrTimeout) clearTimeout(qrTimeout);
      if (qrAutoStopTimer) clearTimeout(qrAutoStopTimer);
      clientInstance = client;
      activeClient = client;
      initializing = false;
      isReady = true;
      currentQr = null;
      isSleeping = false;
      setLifecycleProgress('ready', 100, 'WhatsApp Ready');
      resolve(client);
      markWhatsAppActivity();

      // P1 push event: WA UI updates without polling
      try {
        eventService.broadcast('wa_status_changed', { status: 'ready', service: 'whatsapp' });
      } catch (_) {}

      // Persist authenticated status and connected phone number to app_settings
      try {
        const db = await dbManager.getConnection();
        await db.run(
          `INSERT INTO app_settings (key, value) VALUES ('whatsapp_session_authenticated', 'true')
           ON CONFLICT(key) DO UPDATE SET value = 'true'`
        );
        await db.run(
          `INSERT INTO app_settings (key, value) VALUES ('whatsapp_last_connected_at', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [new Date().toISOString()]
        );

        const infoNumber = (client as any)?.info?.wid?.user || (client as any)?.info?.wid?._serialized?.split('@')[0];
        if (infoNumber) {
          const cleanPhone = String(infoNumber).replace(/\D/g, '');
          console.log(`[WhatsApp Persist] Connected phone number detected: ${cleanPhone}`);

          await db.run(
            `INSERT INTO app_settings (key, value) VALUES ('whatsapp_connected_number', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [cleanPhone]
          );
        }
      } catch (saveErr) {
        console.warn('[WhatsApp Persist] Failed to save connected state to app_settings:', saveErr);
      }

      // Pre-patch window.WWebJS and internal getters in Puppeteer to protect against memoizer crashes on unsaved contacts
      try {
        if (client.pupPage && !client.pupPage.isClosed()) {
          await patchWWebJSInternals(client.pupPage);
        }
      } catch (_) {}

      // Trigger background queue worker with proper pacing and status tracking
      import('./services/whatsappQueueWorker.js').then(({ whatsappQueueWorker }) => {
        whatsappQueueWorker.triggerProcessing();
      }).catch(err => {
        console.warn('[WhatsApp] Could not trigger queue worker on ready:', err);
      });

      // Sync chats separately — failure here must not block send queue drain
      setTimeout(async () => {
        try {
          setLifecycleProgress('syncing', 85, 'Syncing chats & contacts...');
          await waitForChatStoreReady(client, 12000);
          await syncWhatsappData(client);
          setLifecycleProgress('ready', 100, 'WhatsApp Ready');
        } catch (err) {
          console.error('[WhatsApp] Background sync failed:', err);
          setLifecycleProgress('ready', 100, 'WhatsApp Ready');
        }
      }, 5000);
    });

    client.on('disconnected', (reason: string) => {
      console.log('WhatsApp client disconnected:', reason);
      isReady = false;
      clientInstance = null;
      activeClient = null;
      initializing = false;
      isSleeping = false; // a real disconnect must not be reported as deliberate sleep
      setLifecycleProgress('disconnected', 0, `WhatsApp disconnected: ${reason}`);
      if (qrTimeout) clearTimeout(qrTimeout);

      // P4: session folder on disk stays intact — reconnect reuses saved credentials.
      try {
        eventService.broadcast('wa_status_changed', { status: 'disconnected', reason, service: 'whatsapp' });
      } catch (_) {}
      eventService.broadcast('auth_failure', {
        message: 'WhatsApp Web disconnected. Use Reconnect in Settings (your session is saved).',
        service: 'whatsapp'
      });

      client.destroy().catch(() => {}).finally(() => {
        console.log('WhatsApp client destroyed. Waiting for manual or API-triggered reconnect.');
      });
    });

    client.on('auth_failure', async (msg: string) => {
      initializing = false;
      isReady = false;
      activeClient = null;
      isSleeping = false;
      setLifecycleProgress('failed', 0, `Authentication failed: ${msg}`, msg);

      try {
        const db = await dbManager.getConnection();
        await db.run(
          `INSERT INTO app_settings (key, value) VALUES ('whatsapp_session_authenticated', 'false')
           ON CONFLICT(key) DO UPDATE SET value = 'false'`
        );
        await db.run("DELETE FROM app_settings WHERE key = 'whatsapp_connected_number'");
      } catch (_) {}

      eventService.broadcast('auth_failure', {
        message: `WhatsApp authentication failed: ${msg}. Please reconnect in Settings.`,
        service: 'whatsapp'
      });

      reject(new Error(msg));
    });

    // Real remote-logout detection (P4): WhatsApp invalidated the session server-side.
    // Session folder on disk is preserved — only an explicit user Logout wipes credentials.
    client.on('logout', async (_msg?: string) => {
      console.log('[WhatsApp] Remote logout detected by WhatsApp servers.');
      initializing = false;
      isReady = false;
      activeClient = null;
      clientInstance = null;
      isSleeping = false;
      setLifecycleProgress('disconnected', 0, 'WhatsApp signed out remotely');
      if (qrTimeout) clearTimeout(qrTimeout);

      try {
        const db = await dbManager.getConnection();
        await db.run(
          `INSERT INTO app_settings (key, value) VALUES ('whatsapp_session_authenticated', 'false')
           ON CONFLICT(key) DO UPDATE SET value = 'false'`
        );
        await db.run("DELETE FROM app_settings WHERE key = 'whatsapp_connected_number'");
      } catch (_) {}

      eventService.broadcast('wa_status_changed', {
        status: 'logged_out',
        message: 'WhatsApp signed out remotely. Scan the QR code in Settings to sign in again.',
        service: 'whatsapp'
      });

      client.destroy().catch(() => {});
    });

    client.on('message_create', async (msg: any) => {
      try {
        const chatId = msg.to && msg.fromMe ? msg.to : msg.from;
        const db = await dbManager.getConnection();

        if (await isChatIgnored(db, chatId)) {
          return;
        }

        const msgId = msg.id?._serialized || msg.id?.id || `msg_${msg.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        await db.run(
          `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          [
            msgId,
            chatId,
            msg.body || '',
            msg.fromMe ? 1 : 0,
            msg.timestamp || Math.floor(Date.now() / 1000),
            msg.type || 'text',
            msg.hasMedia ? 1 : 0
          ]
        );

        let resolvedNumber = chatId.split('@')[0];
        let chatName = chatId.split('@')[0];
        try {
          const chat = await msg.getChat();
          if (chat) chatName = chat.name || chatName;
        } catch (e) {}

        if (chatId.endsWith('@lid')) {
          try {
            const mapping = await client.getContactLidAndPhone([chatId]);
            if (mapping && mapping[0] && mapping[0].pn) {
              resolvedNumber = mapping[0].pn;
            } else {
              const contact = await msg.getContact();
              if (contact && contact.number && contact.number !== resolvedNumber) {
                resolvedNumber = contact.number;
              }
            }
          } catch (e) {}
        }

        const isFromMe = !!msg.fromMe;
        const nowMs = Date.now();
        const manualTimeoutMs = 5 * 60 * 1000;

        // Fetch existing session state to evaluate Human Takeover
        const existingChatRow = await db.get(
          'SELECT session_mode, manual_active_until, last_pharmacist_message_at, resolved_number FROM whatsapp_chats WHERE id = ?',
          [chatId]
        );
        let sessionMode = existingChatRow?.session_mode || 'auto';
        let manualUntil = Number(existingChatRow?.manual_active_until || 0);
        let sessionStatus = existingChatRow?.session_status || 'idle';

        if (isFromMe) {
          const fullMsg = (msg.body || '').trim();
          const msgHash = hashMessageBody(fullMsg);
          const sendKey1 = `${resolvedNumber}:${msgHash}:${fullMsg.length}`;
          const sendKey2 = `${chatId.split('@')[0]}:${msgHash}:${fullMsg.length}`;
          const dbResolved = (existingChatRow?.resolved_number || '').replace(/@c\.us$/, '').replace(/^91/, '');
          const sendKey3 = dbResolved ? `${dbResolved}:${msgHash}:${fullMsg.length}` : '';
          const sendKey4 = dbResolved ? `91${dbResolved}:${msgHash}:${fullMsg.length}` : '';
          const isAutomatedSend =
            recentSendsCache.has(sendKey1) ||
            recentSendsCache.has(sendKey2) ||
            (sendKey3 ? recentSendsCache.has(sendKey3) : false) ||
            (sendKey4 ? recentSendsCache.has(sendKey4) : false);
          if (!isAutomatedSend) {
            // Pharmacist sent a manual reply from actual WhatsApp phone/web -> activate Human Takeover (5 min silence)
            sessionMode = 'manual';
            manualUntil = nowMs + manualTimeoutMs;
            sessionStatus = 'active';
          }
        } else {
          // Inbound message from patient
          if (sessionMode === 'manual') {
            if (manualUntil > nowMs) {
              sessionStatus = 'waiting'; // Patient replied, waiting for pharmacist review
              manualUntil = nowMs + (10 * 60 * 1000); // Customer replied during manual takeover -> wait 10 min for pharmacist
            } else {
              // Inactivity timeout expired -> revert to auto
              sessionMode = 'auto';
              manualUntil = 0;
              sessionStatus = 'idle';
            }
          }
        }

        await db.run(
          `INSERT INTO whatsapp_chats (
             id, name, unread_count, timestamp, last_message, is_group, resolved_number,
             session_mode, manual_active_until, last_patient_message_at, last_pharmacist_message_at, session_status
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             timestamp=excluded.timestamp,
             last_message=excluded.last_message,
             resolved_number=excluded.resolved_number,
             unread_count = CASE WHEN ? = 0 THEN unread_count + 1 ELSE unread_count END,
             session_mode = excluded.session_mode,
             manual_active_until = excluded.manual_active_until,
             last_patient_message_at = CASE WHEN ? = 1 THEN excluded.last_patient_message_at ELSE last_patient_message_at END,
             last_pharmacist_message_at = CASE WHEN ? = 1 THEN excluded.last_pharmacist_message_at ELSE last_pharmacist_message_at END,
             session_status = excluded.session_status`,
          [
            chatId,
            chatName,
            isFromMe ? 0 : 1,
            msg.timestamp,
            msg.body || '',
            chatId.includes('g.us') ? 1 : 0,
            resolvedNumber,
            sessionMode,
            manualUntil,
            isFromMe ? 0 : nowMs,
            isFromMe ? nowMs : 0,
            sessionStatus,
            isFromMe ? 1 : 0,
            isFromMe ? 0 : 1,
            isFromMe ? 1 : 0
          ]
        );

        eventService.broadcast('wa_new_message', {
          chat_id: chatId,
          resolved_number: resolvedNumber,
          message: {
            id: msg.id._serialized,
            body: msg.body,
            fromMe: msg.fromMe,
            timestamp: msg.timestamp,
            type: msg.type,
            hasMedia: msg.hasMedia
          }
        });

        if (isFromMe || sessionMode === 'manual') {
          eventService.broadcast('wa_session_updated', {
            chat_id: chatId,
            resolved_number: resolvedNumber,
            session_mode: sessionMode,
            session_status: sessionStatus,
            manual_active_until: manualUntil
          });
        }

        // Route inbound customer messages through the existing WhatsApp intent service
        if (!msg.fromMe) {
          import('./services/whatsappIntentService.js')
            .then(mod => {
              const handler = mod.handleInbound || mod.whatsappIntentService?.handleInbound || mod.default?.handleInbound;
              if (handler) {
                handler(msg).catch(err => console.error('[WhatsApp] Intent service execution error:', err));
              } else {
                console.error('[WhatsApp] Could not resolve handleInbound from whatsappIntentService module.');
              }
            })
            .catch(err => console.error('[WhatsApp] Intent service import error:', err));
        }
      } catch (err) {
        console.error('[WhatsApp] Error in message_create event handler:', err);
      }
    });

    client.on('message_ack', async (msg: any, ack: any) => {
      try {
        eventService.broadcast('wa_message_ack', {
          msg_id: msg.id._serialized,
          ack
        });
      } catch (err) {
        console.error('[WhatsApp] Error in message_ack event handler:', err);
      }
    });

    client.initialize().catch(err => {
      clearInitWatchdog();
      const errMsg = err?.message || String(err);
      if (isPuppeteerDetachedError(errMsg)) {
        console.warn('[WhatsApp] Initialize interrupted by teardown/reconnect:', errMsg);
      } else if (
        errMsg.includes('4294967295') ||
        errMsg.includes('exit code: -1') ||
        errMsg.includes('exit code -1') ||
        errMsg.includes('Failed to launch the browser process')
      ) {
        console.warn('[WhatsApp SafeGuard] Browser process closed with transient exit code -1 during launch (retrying silently).');
      } else {
        console.error('[WhatsApp] Failed during initialize():', err);
      }
      initializing = false;
      isReady = false;
      clientInstance = null;
      activeClient = null;
      setLifecycleProgress('failed', 0, `Initialization failed: ${errMsg}`, errMsg);
      reject(err);
    });
  });
}

/** Initialize the WhatsApp client and return it — Boot check + manual invocation contract:
 * The app only connects at boot IF a valid authenticated session exists; otherwise it NEVER
 * auto-launches Chrome unless the user manually invokes it or wakes on demand. */
export async function initClient(options: { forceQr?: boolean; manual?: boolean; isBoot?: boolean } = {}): Promise<WAClient | null> {
  const forceQr = options.forceQr ?? false;
  const isManual = options.manual ?? false;
  const isBoot = options.isBoot ?? false;

  // Strict manual/boot gating: app will NEVER autonomously connect or launch Chrome unless
  // user manually connects, is running the 1-time boot check, or has an authenticated saved session.
  if (!forceQr && !isManual && !isBoot && !(await isWhatsAppAutoConnectAllowed())) {
    console.log('[WhatsApp] Connection suppressed: App will never connect WhatsApp unless user manually invokes it.');
    setLifecycleProgress('disconnected', 0, 'WhatsApp is disconnected. Click Connect to start.');
    return null;
  }

  if (clientInstance && isReady) {
    setLifecycleProgress('ready', 100, 'WhatsApp Ready');
    return clientInstance;
  }

  // Single-flight in-flight Promise: if initialization is already running, join it
  if (initPromise) {
    return initPromise;
  }

  // If Chrome login window popup is currently active, defer background auto-init so they don't contend for profile locks
  if (isLoginWindowActive) {
    console.log('[WhatsApp] Init skipped: Chrome login window is currently active.');
    return null;
  }

  // Check if WhatsApp is disabled in settings
  if (!forceQr && (await isWhatsAppExplicitlyDisabled())) {
    console.log('[WhatsApp] Init skipped: WhatsApp is disabled in Settings.');
    return null;
  }

  // Failure backoff: if a previous init attempt failed recently, suppress automatic retries during the cooldown
  if (forceQr || isManual) {
    lastInitFailureAt = 0; // Explicit user connection resets cooldown
  } else if (lastInitFailureAt > 0 && (Date.now() - lastInitFailureAt) < INIT_FAILURE_COOLDOWN_MS) {
    const remainingSec = Math.ceil((INIT_FAILURE_COOLDOWN_MS - (Date.now() - lastInitFailureAt)) / 1000);
    console.log(`[WhatsApp] Init deferred (${remainingSec}s cooldown remaining after previous failure).`);
    return null;
  }

  // Connectivity check: Do not launch Puppeteer/Chrome if offline
  const { checkConnectivity } = await import('./utils/networkDetector.js');
  const isOnline = await checkConnectivity();
  if (!isOnline) {
    console.log('[WhatsApp] Offline: skipping WhatsApp browser launch until network is restored.');
    setLifecycleProgress('failed', 0, 'Network offline. Standing by for connection.', 'OFFLINE');
    return null;
  }

  initializing = true;
  setLifecycleProgress('waking', 20, 'Cleaning profile locks and starting engine...');

  initPromise = (async () => {
    try {
      // 1. Terminate stale processes and remove lingering profile locks
      await cleanupProfileLocks();
      setLifecycleProgress('waking', 35, 'Releasing Windows file handles...');

      // 2. Windows Kernel Drain Grace Period: allow OS 600ms to cleanly release file handles & mutexes
      if (process.platform === 'win32') {
        await new Promise(resolve => setTimeout(resolve, 600));
      }

      // 3. Launch internal client with single silent retry on transient Windows process lock contention
      setLifecycleProgress('connecting', 50, 'Spawning WhatsApp Web browser instance...');
      try {
        const client = await launchClientInstance(forceQr);
        return client;
      } catch (launchErr: any) {
        const errMsg = launchErr?.message || String(launchErr);
        if (
          errMsg.includes('4294967295') ||
          errMsg.includes('exit code: -1') ||
          errMsg.includes('exit code -1') ||
          errMsg.includes('Failed to launch the browser process')
        ) {
          console.warn('[WhatsApp SafeGuard] Transient lock on initial browser launch (Exit Code -1). Draining locks and retrying once silently...');
          setLifecycleProgress('waking', 30, 'Draining transient profile locks and retrying...');
          await cleanupProfileLocks();
          if (process.platform === 'win32') {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          const client = await launchClientInstance(forceQr);
          return client;
        }
        throw launchErr;
      }
    } catch (err: any) {
      lastInitFailureAt = Date.now();
      initializing = false;
      isReady = false;
      clientInstance = null;
      activeClient = null;
      setLifecycleProgress('failed', 0, `Launch failed: ${err?.message || err}`, err?.message || String(err));
      throw err;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Shared pre-warm entry point: returns current readiness (never launches Chrome autonomously).
 */
export async function prewarmWhatsApp(): Promise<WhatsAppReadinessState> {
  markWhatsAppActivity();
  return getWhatsAppReadiness();
}

/** Destroy the WhatsApp client to release file locks on the session folder */
export async function destroyClient(): Promise<void> {
  console.log('[WhatsApp] Destroying client to release session locks...');
  isReady = false;
  currentQr = null;
  initializing = false;
  if (qrTimeout) {
    clearTimeout(qrTimeout);
    qrTimeout = null;
  }
  if (activeClient) {
    try {
      await Promise.race([
        activeClient.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('client.destroy() timed out')), 15000))
      ]);
    } catch (err) {
      console.error('[WhatsApp] Error destroying client:', err);
    }
    activeClient = null;
  }
  clientInstance = null;
}

/** Force reconnect, clear saved session, and reinitialize for a fresh QR code */
export async function forceReconnect(): Promise<void> {
  console.log('[WhatsApp] Force reconnect requested. Destroying client and clearing session...');

  // 1. Fully destroy active client and clear memory state
  await destroyClient();
  isSleeping = false;

  // 2. Terminate any lingering browser processes holding session files and unlink lockfiles
  await cleanupProfileLocks();

  // 3. Grace delay for Windows kernel to release file handles
  if (process.platform === 'win32') {
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  // 4. Safely clear session folder with retry backoff for Windows EPERM/EBUSY
  const authPath = WWEBJS_AUTH_DIR;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (fs.existsSync(authPath)) {
        safeRemoveDirectorySync(authPath);
        if (!fs.existsSync(authPath) || !hasSavedSession()) {
          console.log('[WhatsApp] Old session data cleared from', authPath);
          break;
        }
      } else {
        break;
      }
    } catch (err: any) {
      if (attempt < 3 && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES')) {
        console.warn(`[WhatsApp] Deleting session folder returned ${err.code}, retrying (${attempt}/3)...`);
        await cleanupProfileLocks();
        await new Promise(r => setTimeout(r, 600));
      } else {
        console.error('[WhatsApp] Failed to clear session folder (non-fatal):', err);
      }
    }
  }

  try {
    const db = await dbManager.getConnection();
    await db.run(
      `INSERT INTO app_settings (key, value) VALUES ('whatsapp_session_authenticated', 'false')
       ON CONFLICT(key) DO UPDATE SET value = 'false'`
    );
    await db.run("DELETE FROM app_settings WHERE key = 'whatsapp_connected_number'");
    await db.run("DELETE FROM ignored_whatsapp_numbers WHERE reason IN ('group', 'broadcast')");
    console.log('[WhatsApp] Cleared auto-ignored group and broadcast chats from database.');
  } catch (err) {
    console.error('[WhatsApp] Failed to clear auto-ignored chats from database (non-fatal):', err);
  }
}

/**
 * ponytail: P4 credentials-are-sacred reconnect.
 * Destroys the running client and restarts it with the SAVED session.
 * NEVER deletes .wwebjs_auth — QR only appears if WhatsApp itself
 * invalidated the session remotely. Used by POST /api/messaging/reconnect.
 */
export async function reconnectClient(): Promise<void> {
  console.log('[WhatsApp] Reconnect requested (non-destructive). Restarting with saved session...');
  await destroyClient();
  await cleanupProfileLocks();
  if (process.platform === 'win32') {
    await new Promise(r => setTimeout(r, 600));
  }
  try {
    await initClient({ forceQr: true });
  } catch (err: any) {
    console.error('[WhatsApp] Non-destructive re-initialization failed (session preserved):', err?.message);
    eventService.broadcast('wa_status_changed', {
      status: 'disconnected',
      message: 'Reconnect failed but your saved WhatsApp session is intact. Retry or scan QR only if asked.',
      service: 'whatsapp'
    });
  }
}

const recentSendsCache = new Map<string, number>();

export interface SendMessageResult {
  sent: boolean;
  suppressed?: boolean;
}

/**
 * Normalizes any phone string to a standard WhatsApp number format (digits only, with country code).
 * Supports: 10-digit Indian (9876543210 -> 919876543210), 11-digit with leading 0 (09876543210 -> 919876543210), 12-digit with 91 (919876543210).
 */
export function normalizeWhatsAppPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `91${digits}`;
  }
  return digits;
}

/** ponytail: shared hash for duplicate-suppress key and outbox verification */
export function hashMessageBody(body: string): number {
  const fullMsg = (body || '').trim();
  let msgHash = 0;
  for (let ci = 0; ci < fullMsg.length; ci++) {
    msgHash = ((msgHash << 5) - msgHash + fullMsg.charCodeAt(ci)) | 0;
  }
  return msgHash;
}

/** Send a media or text message using the WhatsApp Business API or the live WhatsApp Web client, and log it to SQLite */
export async function sendMessage(
  to: string,
  mediaPath?: string,
  caption?: string,
  file?: { mimetype: string; data: string; filename?: string }
): Promise<SendMessageResult> {
  if (!to) {
    console.warn('Attempted to send WhatsApp message to an empty or null number. Skipping.');
    return { sent: false };
  }

  const db = await dbManager.getConnection();
  const recipients = String(to)
    .split(/[,;\s]+/)
    .map(r => r.trim())
    .filter(r => r.length > 0);

  let aggregateResult: SendMessageResult = { sent: false };

  for (const recipient of recipients) {
    const isLidRecipient = recipient.endsWith('@lid');
    let cleanPhone = recipient;
    if (cleanPhone.includes('@')) {
      cleanPhone = cleanPhone.split('@')[0];
    }
    cleanPhone = normalizeWhatsAppPhone(cleanPhone);

    if (!cleanPhone || cleanPhone.length < 8) {
      console.warn(`[WhatsApp] Invalid phone number passed to sendMessage: "${recipient}". Skipping.`);
      throw new Error(`Invalid phone number: "${recipient}" (must contain at least 8 valid digits).`);
    }

    const chatId = isLidRecipient ? recipient : `${cleanPhone}@c.us`;

    // Any send (user-clicked or queue-drained) counts as activity for idle-sleep.
    markWhatsAppActivity();

    // Anti-duplicate protection: prevent identical sends to same recipient within 30s
    // Use a simple hash of the full message to avoid false collisions between different orders
    const fullMsg = (caption || '').trim();
    const msgHash = hashMessageBody(fullMsg);
    const sendKey = `${cleanPhone}:${msgHash}:${fullMsg.length}`;
    const nowTs = Date.now();
    if (recentSendsCache.has(sendKey) && nowTs - recentSendsCache.get(sendKey)! < 30000) {
      console.log(`[WhatsApp Safeguard] Suppressed duplicate send to ${cleanPhone} within 30s.`);
      aggregateResult = { sent: true, suppressed: true };
      continue;
    }

    // Register in-flight BEFORE dispatching: the previous post-send-only registration let
    // two near-simultaneous calls for the same recipient+body both pass the check above
    // while the first was still awaiting delivery, double-delivering the message.
    // The catch below deletes the key on failure so legitimate retries stay unblocked.
    recentSendsCache.set(sendKey, nowTs);

    let success = false;
    let messageId = `msg_out_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    if (await isWhatsAppExplicitlyDisabled()) {
      throw new Error('WhatsApp messaging is disabled in Settings.');
    }

    const useBusiness = await shouldRouteToBusiness();
    if (!useBusiness && (!isReady || !clientInstance)) {
      if (isSleeping || (await isWhatsAppAutoConnectAllowed())) {
        console.log('[WhatsApp] sendMessage: WhatsApp is sleeping or reconnecting, ensuring client is ready...');
        const ready = await ensureWhatsAppReady(30_000);
        if (!ready || !clientInstance) {
          throw new Error('WhatsApp is disconnected. Please connect WhatsApp in Settings before sending messages.');
        }
      } else {
        throw new Error('WhatsApp is not connected. Please connect WhatsApp manually in Settings before sending messages.');
      }
    }

    try {
      if (!useBusiness) {
        // Live WhatsApp Web client. Send via the WA Web.js client.
        let resolvedTargetChatId = chatId;

        // Ground-Truth Phone Registry Lookup:
        // Query local database for any established chat thread (especially @c.us direct phone threads)
        let knownChatId: string | null = null;
        let knownCustomerName: string = '';
        try {
          const last10 = cleanPhone.slice(-10);
          const chatRow = await db.get(
            `SELECT id, name FROM whatsapp_chats 
             WHERE (resolved_number LIKE ? OR id LIKE ?) 
              ORDER BY timestamp DESC, (CASE WHEN id LIKE '%@lid' THEN 1 ELSE 2 END) ASC 
              LIMIT 1`,
            [`%${last10}%`, `%${last10}%`]
          );
          if (chatRow?.id) {
            knownChatId = chatRow.id;
            if (chatRow.name && chatRow.name !== cleanPhone && !chatRow.name.includes('@')) {
              knownCustomerName = chatRow.name;
            }
          }
          if (!knownCustomerName) {
            const custRow = await db.get(
              `SELECT name FROM customers WHERE phone LIKE ? LIMIT 1`,
              [`%${last10}%`]
            );
            if (custRow?.name) knownCustomerName = custRow.name;
          }
        } catch (_) {}

        const doSend = async (targetClient: WAClient, overrideChatId?: string, skipLidResolution = false) => {
          // Priority: overrideChatId > most recent known active chat thread > standard chatId (cleanPhone@c.us)
          let targetChatId = overrideChatId || knownChatId || chatId;
          resolvedTargetChatId = targetChatId;

          // Attempt to resolve contact via getNumberId ONLY if not already a clean phone JID and skipLidResolution is false.
          // Crucial: getNumberId must NEVER overwrite a valid @c.us phone number with a broken @lid JID!
          if (!skipLidResolution && !targetChatId.includes('@c.us') && !targetChatId.includes('@lid') && !chatId.includes('@g.us') && !chatId.includes('@broadcast') && !chatId.includes('-')) {
            try {
              const numberDetails = await targetClient.getNumberId(cleanPhone);
              if (numberDetails && numberDetails._serialized && !numberDetails._serialized.includes('@lid')) {
                targetChatId = numberDetails._serialized;
                resolvedTargetChatId = targetChatId;
              }
            } catch (numErr: any) {
              console.warn(`[WhatsApp] getNumberId resolution note for ${cleanPhone}, fallback to direct JID ${chatId}:`, numErr?.message || numErr);
            }
          }

          // Pre-hydrate chat and contact model in WhatsApp Web store to prevent memoizer 'id undefined' crash
          if (targetClient.pupPage && !targetClient.pupPage.isClosed()) {
            try {
              await patchWWebJSInternals(targetClient.pupPage);
              await targetClient.pupPage.evaluate(async (targetJid, fallbackJid, customerName) => {
                try {
                  const widFactory = (window as any).require?.('WAWebWidFactory');
                  const findChatAction = (window as any).require?.('WAWebFindChatAction');
                  const collections = (window as any).require?.('WAWebCollections');
                  if (widFactory && collections?.Chat) {
                    const jidsToHydrate = [targetJid, fallbackJid].filter(Boolean);
                    for (const jid of jidsToHydrate) {
                      const wid = widFactory.createWid(jid);
                      let chat = collections.Chat.get(wid);
                      if (!chat && collections.Chat.find) {
                        chat = await collections.Chat.find(wid).catch(() => null);
                      }
                      if (!chat && findChatAction?.findOrCreateLatestChat) {
                        const res = await findChatAction.findOrCreateLatestChat(wid).catch(() => null);
                        chat = res?.chat || res;
                      }
                      if (!chat && collections.Chat.add) {
                        try {
                          collections.Chat.add({ id: wid });
                        } catch (_) {}
                      }
                      if (collections?.Contact) {
                        let contact = collections.Contact.get ? collections.Contact.get(wid) : null;
                        if (!contact && collections.Contact.add) {
                          try {
                            collections.Contact.add({
                              id: wid,
                              name: customerName || wid.user,
                              pushname: customerName || wid.user,
                              isMyContact: true,
                              isWAContact: true
                            });
                          } catch (_) {}
                        }
                      }
                    }
                  }
                } catch (_) {}
              }, targetChatId, chatId, knownCustomerName);
            } catch (_) {}
          }

          let sentMsg: any = null;
          if (file && file.mimetype && file.data) {
            let tempSavedPath: string | null = null;
            const safeName = (file.filename || 'media.png').replace(/[^a-zA-Z0-9._-]/g, '_');
            try {
              if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
              tempSavedPath = path.join(UPLOADS_DIR, `temp_${Date.now()}_${safeName}`);
              fs.writeFileSync(tempSavedPath, Buffer.from(file.data, 'base64'));

              const media = MessageMedia.fromFilePath(tempSavedPath);
              const isPdf = safeName.toLowerCase().endsWith('.pdf');
              sentMsg = await targetClient.sendMessage(targetChatId, media, {
                caption: caption ?? '',
                sendMediaAsDocument: isPdf
              });
            } catch (mediaErr: any) {
              console.warn(`[WhatsApp] Media attachment send failed to ${targetChatId}, trying direct phone route ${chatId}:`, mediaErr?.message || mediaErr);
              if (tempSavedPath && fs.existsSync(tempSavedPath) && targetChatId !== chatId) {
                try {
                  const mediaAlt = MessageMedia.fromFilePath(tempSavedPath);
                  sentMsg = await targetClient.sendMessage(chatId, mediaAlt, {
                    caption: caption ?? '',
                    sendMediaAsDocument: safeName.toLowerCase().endsWith('.pdf')
                  });
                } catch (_) {}
              }
              if (!sentMsg && tempSavedPath && fs.existsSync(tempSavedPath)) {
                try {
                  const mediaDoc = MessageMedia.fromFilePath(tempSavedPath);
                  sentMsg = await targetClient.sendMessage(chatId, mediaDoc, {
                    caption: caption ?? '',
                    sendMediaAsDocument: true
                  });
                } catch (_) {}
              }
              if (!sentMsg && caption) {
                console.warn(`[WhatsApp] Falling back to text caption for ${targetChatId}`);
                sentMsg = await targetClient.sendMessage(targetChatId, caption);
              } else if (!sentMsg) {
                throw mediaErr;
              }
            } finally {
              if (tempSavedPath && fs.existsSync(tempSavedPath)) {
                try { fs.unlinkSync(tempSavedPath); } catch (_) {}
              }
            }
          } else if (mediaPath) {
            try {
              const media = MessageMedia.fromFilePath(mediaPath);
              const isPdf = mediaPath.toLowerCase().endsWith('.pdf');
              sentMsg = await targetClient.sendMessage(targetChatId, media, {
                caption: caption ?? '',
                sendMediaAsDocument: isPdf
              });
            } catch (mediaErr: any) {
              const errMsg = mediaErr?.stack || mediaErr?.message || String(mediaErr);
              try { fs.writeFileSync('data/last_media_error.txt', `[${targetChatId}] ${errMsg}`); } catch (_) {}
              console.warn(`[WhatsApp] Media file send failed to ${targetChatId}:`, errMsg);

              // RETRY 1: If primary send failed and wasn't direct phone @c.us, retry media to @c.us
              if (chatId !== targetChatId) {
                try {
                  console.log(`[WhatsApp Ground-Truth] Retrying media send via direct phone route ${chatId}...`);
                  const mediaAlt = MessageMedia.fromFilePath(mediaPath);
                  sentMsg = await targetClient.sendMessage(chatId, mediaAlt, {
                    caption: caption ?? '',
                    sendMediaAsDocument: mediaPath.toLowerCase().endsWith('.pdf')
                  });
                } catch (altErr: any) {
                  console.warn(`[WhatsApp Ground-Truth] Alternate phone media send note:`, altErr?.message || altErr);
                }
              }

              // RETRY 2: Try document fallback if photo failed
              if (!sentMsg && !mediaPath.toLowerCase().endsWith('.pdf')) {
                try {
                  const mediaDoc = MessageMedia.fromFilePath(mediaPath);
                  sentMsg = await targetClient.sendMessage(chatId, mediaDoc, {
                    caption: caption ?? '',
                    sendMediaAsDocument: true
                  });
                } catch (_) {}
              }

              if (!sentMsg && caption) {
                console.warn(`[WhatsApp] Falling back to text caption for ${targetChatId}`);
                sentMsg = await targetClient.sendMessage(targetChatId, caption);
              } else if (!sentMsg) {
                throw mediaErr;
              }
            }
          } else {
            sentMsg = await targetClient.sendMessage(targetChatId, caption ?? '');
          }

          if (sentMsg?.id?._serialized) {
            messageId = sentMsg.id._serialized;
          } else if (sentMsg?.id) {
            messageId = typeof sentMsg.id === 'string' ? sentMsg.id : sentMsg.id._serialized || `${Date.now()}`;
          }
          return sentMsg;
        };

        try {
          await ensureSessionHealth().catch(() => {});
          await doSend(clientInstance!);
          success = true;
        } catch (sendErr: any) {
          const errMsg = sendErr?.message || String(sendErr);

          // Dual-Key Ground-Truth Cascade: If sending to primary route failed and it was an @lid, retry via verified direct phone (@c.us)
          const primaryChatId = resolvedTargetChatId || chatId;
          const alternateChatId = primaryChatId.includes('@lid') ? chatId : null;
          let recoveredViaAlt = false;
          if (alternateChatId && alternateChatId !== primaryChatId) {
            console.log(`[WhatsApp Ground-Truth] Retrying send via alternate direct phone route ${alternateChatId} for ${cleanPhone}...`);
            try {
              await doSend(clientInstance!, alternateChatId, true);
              console.log(`[WhatsApp Ground-Truth] Alternate direct route ${alternateChatId} send succeeded for ${cleanPhone}!`);
              recoveredViaAlt = true;
              success = true;
            } catch (altErr: any) {
              console.warn(`[WhatsApp Ground-Truth] Alternate route retry note:`, altErr?.message || altErr);
            }
          }

          if (!recoveredViaAlt) {
            if (isPuppeteerDetachedError(errMsg)) {
              console.warn('[WhatsApp] Detached Frame or destroyed browser context detected during sendMessage. Invalidating stale client...');
              isReady = false;
              clientInstance = null;
              if (activeClient) {
                activeClient.destroy().catch(() => {});
                activeClient = null;
              }

              console.log('[WhatsApp] Attempting automatic client re-initialization and retry...');
              try {
                const freshClient = await initClient();
                if (!freshClient) throw new Error('Re-initialization returned null client.');
                await doSend(freshClient);
                console.log('[WhatsApp] Automatic re-initialization and message send retry succeeded!');
                success = true;
              } catch (retryErr: any) {
                console.error('[WhatsApp] Send retry after client auto-reconnect failed:', retryErr);
                throw new Error('WhatsApp connection lost (detached browser frame). Please scan the QR code in Settings to reconnect.');
              }
            } else if (errMsg.includes('Data passed to getter must include an id property') || errMsg.includes("it's how we memoize")) {
              console.warn(`[WhatsApp] Memoize getter desync detected for ${cleanPhone}. Running self-healing Store hydration and retry...`);
              try {
                try {
                  await db.run(
                    `INSERT INTO whatsapp_chats (id, name, unread_count, timestamp, last_message, is_group, resolved_number)
                     VALUES (?, ?, 0, ?, '', 0, ?)
                     ON CONFLICT(id) DO UPDATE SET resolved_number = excluded.resolved_number`,
                    [`${cleanPhone}@c.us`, knownCustomerName || cleanPhone, Math.floor(Date.now() / 1000), cleanPhone]
                  );
                } catch (_) {}

                if (clientInstance?.pupPage && !clientInstance.pupPage.isClosed()) {
                  await patchWWebJSInternals(clientInstance.pupPage);
                  await clientInstance.pupPage.evaluate(async (jid) => {
                    try {
                      const widFactory = (window as any).require?.('WAWebWidFactory');
                      const findChatAction = (window as any).require?.('WAWebFindChatAction');
                      const collections = (window as any).require?.('WAWebCollections');
                      if (widFactory && jid && collections?.Chat) {
                        const wid = widFactory.createWid(jid);
                        if (findChatAction?.findOrCreateLatestChat) {
                          await findChatAction.findOrCreateLatestChat(wid).catch(() => {});
                        }
                        if (collections.Chat.add && !collections.Chat.get(wid)) {
                          try {
                            collections.Chat.add({ id: wid });
                          } catch (_) {}
                        }
                        if (collections.Contact?.add && !collections.Contact.get?.(wid)) {
                          try {
                            collections.Contact.add({ id: wid, name: wid.user });
                          } catch (_) {}
                        }
                      }
                    } catch (_) {}
                  }, `${cleanPhone}@c.us`);
                }
              await new Promise(r => setTimeout(r, 600));
              // Force plain @c.us JID + skip getNumberId so we don't re-resolve back to the broken @lid
              await doSend(clientInstance!, `${cleanPhone}@c.us`, true);
              console.log(`[WhatsApp] Self-healing Store hydration and retry succeeded for ${cleanPhone}!`);
              success = true;
            } catch (retryErr: any) {
              console.error(`[WhatsApp] Self-healing retry for ${cleanPhone} failed:`, retryErr?.message || retryErr);
              throw new Error(`WhatsApp Web temporary contact sync delay for ${cleanPhone}. Message queued for review.`);
            }
            } else {
              if (errMsg.includes('No LID for user')) {
                throw new Error(`Contact not registered or not saved in phone contacts (No LID found for ${cleanPhone}). Save this contact in your WhatsApp phone's contact book or verify the phone number.`);
              }
              throw sendErr;
            }
          }
        }

        // Send confirmed — register in recent sends cache
        recentSendsCache.set(sendKey, Date.now());
        if (resolvedTargetChatId && resolvedTargetChatId !== chatId) {
          const lidUser = resolvedTargetChatId.split('@')[0];
          recentSendsCache.set(`${lidUser}:${msgHash}:${fullMsg.length}`, Date.now());
        }

        // Provisional DB record — ensures chat + message appear immediately in UI.
        try {
          const provisionalBody = file ? `[Document] ${file.filename || ''} ${caption || ''}`.trim()
            : (mediaPath ? `[Document] ${path.basename(mediaPath)} ${caption || ''}`.trim() : (caption || ''));
          const provTimestamp = Math.floor(Date.now() / 1000);
          const provHasMedia = file || mediaPath ? 1 : 0;

          await db.run(
            `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
            [messageId, chatId, provisionalBody, 1, provTimestamp, file || mediaPath ? 'document' : 'text', provHasMedia]
          );

          const existingChatRow = await db.get('SELECT name, session_mode, manual_active_until, session_status FROM whatsapp_chats WHERE id = ?', [chatId]);
          const chatNameProv = existingChatRow?.name || cleanPhone;
          const nowProv = Date.now();
          const targetSessionMode = existingChatRow?.session_mode || 'auto';
          const targetManualUntil = existingChatRow?.manual_active_until || 0;
          const targetSessionStatus = existingChatRow?.session_status || 'idle';
          await db.run(
            `INSERT INTO whatsapp_chats (
               id, name, unread_count, timestamp, last_message, is_group, resolved_number,
               session_mode, manual_active_until, last_pharmacist_message_at, session_status
             )
             VALUES (?, ?, 0, ?, ?, 0, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               timestamp = EXCLUDED.timestamp,
               last_message = EXCLUDED.last_message,
               resolved_number = EXCLUDED.resolved_number,
               unread_count = 0`,
            [chatId, chatNameProv, provTimestamp, provisionalBody, cleanPhone, targetSessionMode, targetManualUntil, nowProv, targetSessionStatus]
          );

          eventService.broadcast('wa_new_message', {
            chat_id: chatId,
            resolved_number: cleanPhone,
            message: {
              id: messageId,
              body: provisionalBody,
              fromMe: true,
              timestamp: provTimestamp,
              type: file || mediaPath ? 'document' : 'text',
              hasMedia: !!provHasMedia
            }
          });

          eventService.broadcast('wa_session_updated', {
            chat_id: chatId,
            resolved_number: cleanPhone,
            session_mode: 'manual',
            session_status: 'active',
            manual_active_until: nowProv + (5 * 60 * 1000)
          });

          import('./services/whatsappDeliveryRegister.js')
            .then(m => m.whatsappDeliveryRegister.recordDelivery(cleanPhone, provisionalBody, file || mediaPath ? 'media' : 'text', undefined, undefined, messageId))
            .catch(() => {});
        } catch (provErr: any) {
          console.warn('[WhatsApp] Provisional DB write failed (non-fatal):', provErr?.message);
        }

        aggregateResult = { sent: true, suppressed: false };
        continue;
      } else {
        if (file && file.mimetype && file.data) {
          if (!fs.existsSync(appConfig.tempDir)) {
            fs.mkdirSync(appConfig.tempDir, { recursive: true });
          }
          const tempFilePath = path.join(appConfig.tempDir, `wa_temp_${Date.now()}_${file.filename || 'document.pdf'}`);
          fs.writeFileSync(tempFilePath, Buffer.from(file.data, 'base64'));
          try {
            const result = await whatsappBusinessService.sendDocument(cleanPhone, tempFilePath, caption, file.filename);
            success = result.success;
            if (result.messageId) messageId = result.messageId;
          } finally {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
          }
        } else if (mediaPath) {
          const result = await whatsappBusinessService.sendDocument(cleanPhone, mediaPath, caption);
          success = result.success;
          if (result.messageId) messageId = result.messageId;
        } else {
          const result = await whatsappBusinessService.sendTextMessage(cleanPhone, caption ?? '');
          success = result.success;
          if (result.messageId) messageId = result.messageId;
        }

        if (!success) {
          throw new Error('WhatsApp Business API rejected message transmission');
        }

        // Send confirmed — register in recent sends cache
        recentSendsCache.set(sendKey, Date.now());
      }
    } catch (err: any) {
      // Clear cache on error so retries are never blocked
      recentSendsCache.delete(sendKey);
      console.error('[WhatsApp Client Wrapper] Send failed:', err?.message || err);
      throw err;
    }

    // Business API sends have no local client event to log them, so write here.
    // (The automated/whatsapp-web.js branch never reaches this point — it `continue`s above.)
    const bodyText = file ? `[Document] ${file.filename || ''} ${caption || ''}` : (mediaPath ? `[Document] ${path.basename(mediaPath)} ${caption || ''}` : (caption || ''));
    const timestamp = Math.floor(Date.now() / 1000);
    const hasMedia = file || mediaPath ? 1 : 0;

    try {
      await db.run(
        `INSERT INTO whatsapp_messages (id, chat_id, body, from_me, timestamp, type, has_media)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [messageId, chatId, bodyText, 1, timestamp, file || mediaPath ? 'document' : 'text', hasMedia]
      );

      const existingChat = await db.get('SELECT name, session_mode, manual_active_until, session_status FROM whatsapp_chats WHERE id = ?', [chatId]);
      const chatName = existingChat?.name || cleanPhone;
      const nowFinal = Date.now();
      const finalSessionMode = existingChat?.session_mode || 'auto';
      const finalManualUntil = existingChat?.manual_active_until || 0;
      const finalSessionStatus = existingChat?.session_status || 'idle';

      await db.run(
        `INSERT INTO whatsapp_chats (
           id, name, unread_count, timestamp, last_message, is_group, resolved_number,
           session_mode, manual_active_until, last_pharmacist_message_at, session_status
         )
         VALUES (?, ?, 0, ?, ?, 0, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           timestamp = EXCLUDED.timestamp,
           last_message = EXCLUDED.last_message,
           resolved_number = EXCLUDED.resolved_number,
           unread_count = 0`,
        [chatId, chatName, timestamp, bodyText, cleanPhone, finalSessionMode, finalManualUntil, nowFinal, finalSessionStatus]
      );

      eventService.broadcast('wa_new_message', {
        chat_id: chatId,
        message: {
          id: messageId,
          body: bodyText,
          fromMe: true,
          timestamp,
          type: file || mediaPath ? 'document' : 'text',
          hasMedia: !!hasMedia
        }
      });

      eventService.broadcast('wa_session_updated', {
        chat_id: chatId,
        resolved_number: cleanPhone,
        session_mode: 'manual',
        session_status: 'active',
        manual_active_until: nowFinal + (5 * 60 * 1000)
      });

      import('./services/whatsappDeliveryRegister.js')
        .then(m => m.whatsappDeliveryRegister.recordDelivery(cleanPhone, bodyText, file || mediaPath ? 'media' : 'text', undefined, undefined, messageId))
        .catch(() => {});
    } catch (dbErr) {
      console.error('[WhatsApp Client Wrapper] SQLite write error:', dbErr);
    }

    aggregateResult = { sent: true, suppressed: false };
  }

  return aggregateResult.sent ? aggregateResult : { sent: false };
}

/** Get all chats from the local SQLite cache with contact name enrichment and LID deduplication */
export async function getChats(): Promise<any[]> {
  try {
    markWhatsAppActivity(); // user is viewing the inbox — keep the browser awake
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT id, name, unread_count as unreadCount, timestamp, is_group as isGroup, last_message as lastMessage, resolved_number as resolvedNumber,
              session_mode as sessionMode, manual_active_until as manualActiveUntil,
              last_patient_message_at as lastPatientMessageAt, last_pharmacist_message_at as lastPharmacistMessageAt,
              session_status as sessionStatus
       FROM whatsapp_chats
       ORDER BY timestamp DESC`
    );

    // Deduplicate chats that share the same last 10 digits (e.g. @lid vs @c.us)
    const nowMs = Date.now();
    const dedupedMap = new Map<string, any>();
    for (const r of rows) {
      const rawNum = r.resolvedNumber || (r.id ? r.id.split('@')[0] : '');
      const digits = rawNum.replace(/\D/g, '');
      const key = digits.length >= 10 ? digits.slice(-10) : (r.id || rawNum);

      // Check if 45m inactivity timeout expired
      let mode = r.sessionMode || 'auto';
      let status = r.sessionStatus || 'idle';
      if (mode === 'manual' && r.manualActiveUntil && r.manualActiveUntil < nowMs) {
        mode = 'auto';
        status = 'idle';
      }

      // Check if waiting > 5 minutes without pharmacist reply
      const lastPatientTime = Number(r.lastPatientMessageAt || (r.timestamp ? r.timestamp * 1000 : 0));
      const lastPharmacistTime = Number(r.lastPharmacistMessageAt || 0);
      const isWaitingForPharmacist = status === 'waiting' || (mode === 'manual' && lastPatientTime > lastPharmacistTime);
      const isUnansweredOver5Min = Boolean(
        isWaitingForPharmacist &&
        lastPatientTime > 0 &&
        (nowMs - lastPatientTime) > (5 * 60 * 1000)
      );

      const enrichedItem = {
        ...r,
        sessionMode: mode,
        sessionStatus: status,
        isUnansweredOver5Min
      };

      if (dedupedMap.has(key)) {
        const existing = dedupedMap.get(key);
        existing.unreadCount = (existing.unreadCount || 0) + (r.unreadCount || 0);
        if (r.timestamp && r.timestamp > (existing.timestamp || 0)) {
          existing.timestamp = r.timestamp;
          if (r.lastMessage) existing.lastMessage = r.lastMessage;
          existing.sessionMode = enrichedItem.sessionMode;
          existing.sessionStatus = enrichedItem.sessionStatus;
          existing.isUnansweredOver5Min = enrichedItem.isUnansweredOver5Min;
        }
      } else {
        dedupedMap.set(key, enrichedItem);
      }
    }
    const resultRows = Array.from(dedupedMap.values());

    // Enrich names from pharmacy DB tables (customers, refills, delivery_boys, doctors)
    for (const r of resultRows) {
      const rawNum = r.resolvedNumber || (r.id ? r.id.split('@')[0] : '');
      const digits = rawNum.replace(/\D/g, '');
      const last10 = digits.length >= 10 ? digits.slice(-10) : '';

      if (last10) {
        const likePattern = `%${last10}%`;

        // 1. Check customers
        const cust = await db.get('SELECT name FROM customers WHERE phone LIKE ? AND name IS NOT NULL AND name != "" LIMIT 1', [likePattern]);
        if (cust?.name) {
          r.name = cust.name;
          continue;
        }

        // 2. Check patient refills
        const refill = await db.get('SELECT patient_name FROM patient_refills WHERE patient_phone LIKE ? AND patient_name IS NOT NULL AND patient_name != "" LIMIT 1', [likePattern]);
        if (refill?.patient_name) {
          r.name = refill.patient_name;
          continue;
        }

        // 3. Check delivery boys
        const deliv = await db.get('SELECT name FROM delivery_boys WHERE whatsapp_number LIKE ? AND name IS NOT NULL AND name != "" LIMIT 1', [likePattern]);
        if (deliv?.name) {
          r.name = deliv.name;
          continue;
        }

        // 4. Check doctors
        const doc = await db.get('SELECT name FROM doctors WHERE phone LIKE ? AND name IS NOT NULL AND name != "" LIMIT 1', [likePattern]);
        if (doc?.name) {
          r.name = doc.name;
          continue;
        }

        // 5. Check sales invoices via joined customer record
        const sale = await db.get(
          `SELECT c.name as customer_name
           FROM sales_invoices si
           JOIN customers c ON si.customer_id = c.id
           WHERE c.phone LIKE ? AND c.name IS NOT NULL AND c.name != ""
           LIMIT 1`,
          [likePattern]
        );
        if (sale?.customer_name) {
          r.name = sale.customer_name;
          continue;
        }

        // 6. Check distributors table (learned from OCR / AI Learning page)
        const dist = await db.get(
          'SELECT name FROM distributors WHERE (phone LIKE ? OR phone = ?) AND name IS NOT NULL AND name != "" LIMIT 1',
          [likePattern, last10]
        );
        if (dist?.name) {
          r.name = dist.name;
        }
      }
    }

    return resultRows;
  } catch (err) {
    console.error('[WhatsApp Client Wrapper] getChats SQLite error:', err);
    return [];
  }
}

/** Get messages for a specific chat from local SQLite cache, matching across @lid and @c.us */
export async function getChatMessages(chatId: string, limit: number = 500): Promise<any[]> {
  const raw = String(chatId || '').trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, '');
  const phoneWithoutCc = digits.length >= 10 ? digits.slice(-10) : digits;
  const likePattern = `%${phoneWithoutCc}%`;

  try {
    const db = await dbManager.getConnection();

    // Look up all chat IDs associated with this contact in whatsapp_chats
    const relatedChatIds = new Set<string>([raw]);
    if (phoneWithoutCc && phoneWithoutCc.length >= 7) {
      const chatRows = await db.all(
        `SELECT id, resolved_number FROM whatsapp_chats
         WHERE id = ? OR id LIKE ? OR resolved_number LIKE ? OR resolved_number = ?`,
        [raw, likePattern, likePattern, phoneWithoutCc]
      );
      for (const c of chatRows) {
        if (c.id) relatedChatIds.add(c.id);
        if (c.resolved_number) {
          relatedChatIds.add(c.resolved_number);
          relatedChatIds.add(`${c.resolved_number}@c.us`);
        }
      }
    }

    const idList = Array.from(relatedChatIds);
    const inPlaceholders = idList.map(() => '?').join(',');
    const params: any[] = [...idList];

    let whereClause = `wm.chat_id IN (${inPlaceholders})`;
    if (phoneWithoutCc && phoneWithoutCc.length >= 7) {
      whereClause += ` OR wm.chat_id LIKE ?`;
      params.push(likePattern);
    }
    params.push(limit);

    const rows = await db.all(
      `SELECT wm.id, wm.body, wm.from_me as fromMe, wm.timestamp,
              wm.type, wm.has_media as hasMedia,
              sm.result_json as scannedResult
       FROM whatsapp_messages wm
       LEFT JOIN scanned_messages sm ON sm.msg_id = wm.id
       WHERE ${whereClause}
       ORDER BY wm.timestamp ASC
       LIMIT ?`,
      params
    );
    return rows;
  } catch (err) {
    console.error('[WhatsApp Client Wrapper] getChatMessages SQLite error:', err);
    return [];
  }
}


/** Retrieve cached media file from local storage */
export async function getMessageMedia(chatId: string, messageId: string): Promise<{ mimetype: string; data: string; filename?: string }> {
  const safeId = String(messageId || '').replace(/[^a-zA-Z0-9_-]/g, '_');

  // Check data/inbound_media first (where customer WhatsApp photos are stored)
  const inboundDir = path.resolve(process.cwd(), 'data', 'inbound_media');
  if (safeId && fs.existsSync(inboundDir)) {
    for (const ext of ['.jpg', '.jpeg', '.png', '.pdf']) {
      const p = path.join(inboundDir, `${safeId}${ext}`);
      if (fs.existsSync(p)) {
        const data = fs.readFileSync(p).toString('base64');
        const mimetype = ext === '.png' ? 'image/png' : ext === '.pdf' ? 'application/pdf' : 'image/jpeg';
        return { mimetype, data, filename: `${safeId}${ext}` };
      }
    }
  }

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  // Look for any file in the uploads directory that starts with the messageId
  const files = fs.readdirSync(UPLOADS_DIR);
  const matchedFile = files.find(f => f.startsWith(messageId));

  if (!matchedFile) {
    // Attempt live on-demand download via resilient cascade
    try {
      if ((!isReady || !clientInstance) && hasSavedSession()) {
        await waitForWhatsAppReady(20_000);
      }
      const downloaded = await downloadMessageMediaReliably(messageId, { chatId, maxWaitMs: 15000 });
      if (downloaded?.data) {
        const buffer = Buffer.from(downloaded.data, 'base64');
        if (!fs.existsSync(inboundDir)) fs.mkdirSync(inboundDir, { recursive: true });
        const filePath = path.join(inboundDir, `${safeId}.jpg`);
        fs.writeFileSync(filePath, buffer);
        try {
          fs.writeFileSync(path.join(UPLOADS_DIR, `${safeId}.jpg`), buffer);
        } catch (_) {}
        return {
          mimetype: downloaded.mimetype || 'image/jpeg',
          data: downloaded.data,
          filename: downloaded.filename || `${safeId}.jpg`
        };
      }
    } catch (dlErr) {
      console.warn(`[WhatsApp Client] On-demand media download failed for ${messageId}:`, dlErr);
    }

    throw new Error(`Media not found locally for message ID: ${messageId}`);
  }

  const filePath = path.join(UPLOADS_DIR, matchedFile);
  const ext = path.extname(matchedFile).toLowerCase();

  let mimetype = 'image/jpeg';
  if (ext === '.png') mimetype = 'image/png';
  else if (ext === '.pdf') mimetype = 'application/pdf';
  else if (ext === '.mp3') mimetype = 'audio/mp3';
  else if (ext === '.mp4') mimetype = 'video/mp4';

  const data = fs.readFileSync(filePath).toString('base64');
  return {
    mimetype,
    data,
    filename: matchedFile
  };
}

/**
 * Download media for an inbound message by re-hydrating a FRESH Message
 * instance from the client store via getMessageById(). Event-emitted Message
 * objects frequently lose their media-decrypt context (whatsapp-web.js throws
 * minified internals like Error("r") — observed on @lid chats and after
 * idle-sleep wakes), while a store-fresh instance still downloads fine.
 * Returns undefined when no ready client exists; never throws for
 * missing/unreachable messages beyond what downloadMedia itself raises.
 */
export async function downloadMessageMediaById(serializedId: string): Promise<{ data?: string; mimetype?: string } | undefined> {
  if (!clientInstance || !isReady || !serializedId) return undefined;
  const fresh: any = await clientInstance.getMessageById(serializedId);
  if (!fresh) return undefined;
  return await fresh.downloadMedia();
}

/**
 * Resiliently download media for an inbound message:
 * 1. Tier 1: Direct Node.js WhatsApp CDN decryption via crypto HKDF + AES-256-CBC (zero browser UI dependency).
 * 2. Tier 2: In-browser blob fetch (msg.mediaData.renderableUrl) and WAWebDownloadManager.
 * 3. Tier 3: Browser-extracted metadata passed back to Node decryptor.
 * 4. Tier 4: Store-fresh getMessageById copy.
 * 5. Tier 5: High-res embedded thumbnail / preview fallback.
 */
export async function downloadMessageMediaReliably(
  rawId: string,
  options?: { maxWaitMs?: number; chatId?: string; rawMsg?: any }
): Promise<{ data?: string; mimetype?: string; filename?: string } | undefined> {

  if ((!clientInstance || !isReady) && hasSavedSession()) {
    console.log(`[WhatsApp Client] downloadMessageMediaReliably for ${rawId} called while client is not ready — waiting for session restore...`);
    await waitForWhatsAppReady(20_000);
  }
  if (!clientInstance || !isReady || !rawId) return undefined;
  const maxWaitMs = options?.maxWaitMs ?? 12000;
  const chatId = options?.chatId;
  const rawMsg = options?.rawMsg;
  const serializedId = (!rawId.includes('_') && chatId) ? `false_${chatId}_${rawId}` : rawId;

  // ── Tier 1: Direct Node.js CDN Decryption (Pure Node, Zero Browser UI dependency) ──
  const rawData = rawMsg?._data;
  const directPath = rawData?.directPath || rawMsg?.directPath;
  const mediaKey = rawData?.mediaKey || rawMsg?.mediaKey;
  if (directPath && mediaKey) {
    try {
      const { extractWhatsAppMedia } = await import('./utils/whatsappMediaDecryptor.js');
      const cdnResult = await extractWhatsAppMedia({
        directPath,
        mediaKey,
        mimetype: rawData?.mimetype || rawMsg?.mimetype || 'image/jpeg',
        type: rawData?.type || rawMsg?.type || 'image',
        encFilehash: rawData?.encFilehash || rawMsg?.encFilehash,
        filehash: rawData?.filehash || rawMsg?.filehash,
        preview: rawData?.body || rawMsg?.body
      }, 10000);

      if (cdnResult?.data) {
        console.log(`[WhatsApp Client] Direct Node CDN media decryption succeeded (${cdnResult.source}) for msgId=${serializedId}`);
        return {
          data: cdnResult.data,
          mimetype: cdnResult.mimetype,
          filename: `${serializedId}.jpg`
        };
      }
    } catch (nodeDecryptErr: any) {
      console.warn('[WhatsApp Client] Direct Node CDN decrypt error:', nodeDecryptErr?.message || nodeDecryptErr);
    }
  }

  // ── Tier 2 & 3: Browser evaluate with blob URL fetch + downloadManager + metadata extraction ──
  let downloaded: any = null;
  if ((clientInstance as any).pupPage) {
    try {
      // Log WA Web version so we can correlate API failures with WhatsApp Web updates
      try {
        const waVersion = await (clientInstance as any).pupPage.evaluate(() => (window as any).Debug?.VERSION || 'unknown');
        console.log(`[WhatsApp Client] downloadMessageMediaReliably — msgId=${serializedId} waVersion=${waVersion}`);
      } catch (_) {}

      // Ensure esbuild/tsx __name helper is defined in browser context
      try {
        await (clientInstance as any).pupPage.evaluate('window.__name = window.__name || function(fn) { return fn; };');
      } catch (_) {}

      downloaded = await (clientInstance as any).pupPage.evaluate(async (msgId: string, waitLimit: number, targetChatId?: string, bareId?: string) => {
        try {
          const wCollections = (window as any).require ? (window as any).require('WAWebCollections') : null;
          const store = (window as any).Store;

          let msg: any = null;
          let chat: any = null;

          if (targetChatId) {
            try {
              if ((window as any).WWebJS?.getChat) {
                chat = await (window as any).WWebJS.getChat(targetChatId, { getAsModel: false });
              }
            } catch (_) {}
            if (!chat && store?.Chat) {
              try {
                chat = store.Chat.get(targetChatId) || (await store.Chat.find(targetChatId));
              } catch (_) {}
            }
            if (chat) {
              try { if (chat.loadEarlierMsgs) await chat.loadEarlierMsgs(); } catch (_) {}
              if (chat.msgs?.models) {
                msg = chat.msgs.models.find((m: any) =>
                  m.id?._serialized === msgId ||
                  m.id?.id === msgId ||
                  (bareId && (m.id?.id === bareId || m.id?._serialized?.includes(bareId)))
                );
              }
            }
          }

          if (!msg) {
            msg = wCollections?.Msg?.get(msgId) || store?.Msg?.get(msgId);
          }
          if (!msg && store?.Msg?.models) {
            msg = store.Msg.models.find((m: any) =>
              m.id?._serialized === msgId ||
              m.id?.id === msgId ||
              (bareId && (m.id?.id === bareId || m.id?._serialized?.includes(bareId)))
            );
          }
          if (!msg && targetChatId) {
            const c1 = `false_${targetChatId}_${bareId || msgId}`;
            const c2 = `true_${targetChatId}_${bareId || msgId}`;
            msg = wCollections?.Msg?.get(c1) || store?.Msg?.get(c1)
               || wCollections?.Msg?.get(c2) || store?.Msg?.get(c2);
            if (!msg && wCollections?.Msg?.getMessagesById) {
              const res = await wCollections.Msg.getMessagesById([c1, c2, msgId]);
              msg = res?.messages?.[0] || res?.messages?.[1] || res?.messages?.[2];
            }
          }

          if (!msg) return { error: 'msg_not_found' };

          // Extract raw media metadata for Node.js fallback decryption
          const msgMeta = {
            directPath: msg.directPath,
            mediaKey: msg.mediaKey,
            encFilehash: msg.encFilehash,
            filehash: msg.filehash,
            mimetype: msg.mimetype || 'image/jpeg',
            type: msg.type || 'image',
            preview: msg.body || msg.mediaData?.preview
          };

          // Check if a renderable blob URL is already available in the browser DOM
          if (msg.mediaData?.renderableUrl) {
            try {
              const blobResp = await fetch(msg.mediaData.renderableUrl);
              const ab = await blobResp.arrayBuffer();
              const bytes = new Uint8Array(ab);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
              return { data: btoa(binary), mimetype: msg.mimetype || 'image/jpeg', filename: msg.filename };
            } catch (_) {}
          }

          if (!msg.mediaData) return { error: 'no_media_data', msgMeta };

          // Record initial stage for logging
          const initialStage = msg.mediaData.mediaStage || 'unknown';

          if (msg.mediaData.mediaStage !== 'RESOLVED') {
            if (typeof msg.downloadMedia === 'function') {
              try {
                await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
              } catch (_) {}
            }
          }

          const start = Date.now();
          while (Date.now() - start < waitLimit) {
            if (msg.mediaData.mediaStage === 'RESOLVED') break;
            if (msg.mediaData.mediaStage && msg.mediaData.mediaStage.includes('ERROR')) break;
            await new Promise(r => setTimeout(r, 400));
          }

          // Check renderableUrl again after waiting
          if (msg.mediaData?.renderableUrl) {
            try {
              const blobResp = await fetch(msg.mediaData.renderableUrl);
              const ab = await blobResp.arrayBuffer();
              const bytes = new Uint8Array(ab);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
              return { data: btoa(binary), mimetype: msg.mimetype || 'image/jpeg', filename: msg.filename };
            } catch (_) {}
          }

          const mockQpl = { addAnnotations: () => {}, addPoint: () => {} };
          // Try WAWebDownloadManager (primary internal API)
          let downloadManager = (window as any).require?.('WAWebDownloadManager')?.downloadManager;
          // Fallback: some WA Web versions expose it under a different module path
          if (!downloadManager) {
            downloadManager = (window as any).require?.('WAWebDownloadManager/WAWebDownloadManager')?.downloadManager
              || (window as any).require?.('WAWebDownloadManagerWeb')?.downloadManager;
          }

          if (downloadManager && msg.directPath && msg.mediaKey) {
            const decryptedMedia = await downloadManager.downloadAndMaybeDecrypt({
              directPath: msg.directPath,
              encFilehash: msg.encFilehash,
              filehash: msg.filehash,
              mediaKey: msg.mediaKey,
              mediaKeyTimestamp: msg.mediaKeyTimestamp,
              type: msg.type,
              signal: new AbortController().signal,
              downloadQpl: mockQpl,
            });

            // WWebJS.arrayBufferToBase64Async may not exist on all versions — fall back to manual conversion
            let data: string;
            if (typeof (window as any).WWebJS?.arrayBufferToBase64Async === 'function') {
              data = await (window as any).WWebJS.arrayBufferToBase64Async(decryptedMedia);
            } else {
              const bytes = new Uint8Array(decryptedMedia);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
              data = btoa(binary);
            }
            return {
              data,
              mimetype: msg.mimetype,
              filename: msg.filename
            };
          }

          return { error: `media_stage_${msg.mediaData?.mediaStage || 'unknown'}`, initialStage, msgMeta };
        } catch (innerErr: any) {
          return { error: innerErr?.message || String(innerErr) };
        }
      }, serializedId, maxWaitMs, chatId, rawId);

      console.log(`[WhatsApp Client] downloadMessageMediaReliably evaluate result for ${rawId}:`, JSON.stringify(downloaded));

      if (downloaded && downloaded.data) {
        return {
          data: downloaded.data,
          mimetype: downloaded.mimetype,
          filename: downloaded.filename
        };
      }

      // ── Tier 3: If in-browser decryption didn't return data, use extracted msgMeta in Node ──
      if (downloaded?.msgMeta?.directPath && downloaded?.msgMeta?.mediaKey) {
        console.log(`[WhatsApp Client] Browser evaluate provided media metadata for ${serializedId}. Executing Node CDN decryptor...`);
        try {
          const { extractWhatsAppMedia } = await import('./utils/whatsappMediaDecryptor.js');
          const metaResult = await extractWhatsAppMedia(downloaded.msgMeta, 12000);
          if (metaResult?.data) {
            console.log(`[WhatsApp Client] Node CDN decryptor succeeded via browser metadata (${metaResult.source}) for ${serializedId}`);
            return {
              data: metaResult.data,
              mimetype: metaResult.mimetype,
              filename: `${serializedId}.jpg`
            };
          }
        } catch (mErr: any) {
          console.warn('[WhatsApp Client] Browser metadata Node decrypt failed:', mErr?.message || mErr);
        }
      }

      if (downloaded?.error) {
        console.warn(`[WhatsApp Client] Browser media download failed — stage=${downloaded.error} initialStage=${downloaded.initialStage || 'n/a'} msgId=${serializedId}`);
      }
    } catch (evalErr) {
      console.warn('[WhatsApp Client] Reliable browser media evaluate failed, falling back to getMessageById:', evalErr);
    }
  }

  // ── Tier 4: Fallback to fresh getMessageById ──
  try {
    const storeFresh = await downloadMessageMediaById(serializedId);
    if (storeFresh?.data) return storeFresh;
  } catch (freshErr) {
    console.warn(`[WhatsApp Client] Tier 4 downloadMessageMediaById failed for ${serializedId}:`, freshErr instanceof Error ? freshErr.message : String(freshErr));
  }

  // ── Tier 5: Fallback to raw preview thumbnail if available ──
  const previewData =
    (rawData?.body && typeof rawData.body === 'string' && rawData.body.length > 50 ? rawData.body : null) ||
    (rawMsg?.body && typeof rawMsg.body === 'string' && rawMsg.body.length > 50 ? rawMsg.body : null) ||
    (downloaded?.msgMeta?.preview && typeof downloaded.msgMeta.preview === 'string' && downloaded.msgMeta.preview.length > 50 ? downloaded.msgMeta.preview : null);

  if (previewData) {
    console.log(`[WhatsApp Client] Using raw preview thumbnail as final fallback for ${serializedId}`);
    return {
      data: previewData.replace(/^data:image\/[a-z]+;base64,/, ''),
      mimetype: rawData?.mimetype || rawMsg?.mimetype || 'image/jpeg',
      filename: `${serializedId}_thumb.jpg`
    };
  }

  return undefined;
}

// In-memory cache for WhatsApp registration status (24 hours for verified, 12 hours for not registered)
const waRegistrationCache = new Map<string, { status: 'AVAILABLE' | 'NOT_AVAILABLE'; expiresAt: number }>();

/**
 * Checks WhatsApp capability for a phone number.
 * Conforms to MULTI-PHARMACY.md §16 (debounced, non-blocking, non-waking probe).
 */
export async function checkPhoneWhatsAppRegistered(cleanDigits10: string): Promise<'AVAILABLE' | 'NOT_AVAILABLE' | 'UNABLE_TO_VERIFY'> {
  if (!cleanDigits10 || cleanDigits10.length !== 10) return 'NOT_AVAILABLE';

  // Check cache first for instant resolution
  const cached = waRegistrationCache.get(cleanDigits10);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.status;
  }

  if (!isReady || !clientInstance) {
    return 'UNABLE_TO_VERIFY';
  }
  try {
    const formatted = cleanDigits10.startsWith('91') ? cleanDigits10 : `91${cleanDigits10}`;
    const TIMEOUT_SENTINEL = Symbol('TIMEOUT');

    const result = await Promise.race([
      clientInstance.getNumberId(formatted),
      new Promise<typeof TIMEOUT_SENTINEL>((resolve) => setTimeout(() => resolve(TIMEOUT_SENTINEL), 3000))
    ]);

    if (result === TIMEOUT_SENTINEL) {
      return 'UNABLE_TO_VERIFY';
    }

    if (result && (result as any)._serialized) {
      waRegistrationCache.set(cleanDigits10, { status: 'AVAILABLE', expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
      return 'AVAILABLE';
    }

    if (result === null) {
      waRegistrationCache.set(cleanDigits10, { status: 'NOT_AVAILABLE', expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      return 'NOT_AVAILABLE';
    }

    return 'UNABLE_TO_VERIFY';
  } catch (_) {
    return 'UNABLE_TO_VERIFY';
  }
}

/**
 * Manually resolve / end a chat session (Human-in-the-loop: pharmacist finishes attending to customer)
 */
export async function resolveChatSession(chatId: string): Promise<boolean> {
  try {
    const db = await dbManager.getConnection();
    await db.run(
      `UPDATE whatsapp_chats 
       SET session_mode = 'auto', session_status = 'ended', manual_active_until = 0, unread_count = 0 
       WHERE id = ?`,
      [chatId]
    );
    eventService.broadcast('wa_session_updated', {
      chat_id: chatId,
      session_mode: 'auto',
      session_status: 'ended',
      manual_active_until: 0
    });
    return true;
  } catch (err) {
    console.error('[WhatsApp Client] Failed to resolve chat session:', err);
    return false;
  }
}
