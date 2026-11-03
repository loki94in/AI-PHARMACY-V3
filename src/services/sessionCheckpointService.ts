import fs from 'fs';
import path from 'path';

export interface SessionCheckpoint {
  route: string;
  targetVersion?: string;
  previousVersion?: string;
  timestamp: number;
  resumed: boolean;
  metadata?: Record<string, any>;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const CHECKPOINT_PATH = path.join(DATA_DIR, 'session_checkpoint.json');
const MAX_CHECKPOINT_AGE_MS = 60 * 60 * 1000; // 1 hour max validity

/**
 * Ensures the data directory exists.
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (_) {}
  }
}

/**
 * Saves a session checkpoint atomically using write-to-temp then rename (Coucou parity).
 */
export function saveSessionCheckpoint(checkpoint: Partial<SessionCheckpoint>): void {
  try {
    ensureDataDir();
    const existing = getSessionCheckpoint() || {
      route: '/pos',
      timestamp: Date.now(),
      resumed: false,
    };

    const merged: SessionCheckpoint = {
      route: checkpoint.route || existing.route || '/pos',
      targetVersion: checkpoint.targetVersion || existing.targetVersion,
      previousVersion: checkpoint.previousVersion || existing.previousVersion,
      timestamp: checkpoint.timestamp || Date.now(),
      resumed: checkpoint.resumed ?? false,
      metadata: { ...(existing.metadata || {}), ...(checkpoint.metadata || {}) },
    };

    const tmpPath = `${CHECKPOINT_PATH}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf8');
    fs.renameSync(tmpPath, CHECKPOINT_PATH);
  } catch (err: any) {
    console.warn('[SessionCheckpoint] Failed to save session checkpoint:', err.message);
  }
}

/**
 * Reads the session checkpoint from disk.
 * Returns null if missing, invalid, or expired (>1 hr old).
 */
export function getSessionCheckpoint(): SessionCheckpoint | null {
  try {
    if (!fs.existsSync(CHECKPOINT_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as SessionCheckpoint;

    if (!parsed || typeof parsed.route !== 'string') {
      return null;
    }

    // Ignore checkpoints older than 1 hour to prevent stale restoration
    if (parsed.timestamp && Date.now() - parsed.timestamp > MAX_CHECKPOINT_AGE_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Marks the existing checkpoint as resumed.
 */
export function markCheckpointResumed(): void {
  try {
    const cp = getSessionCheckpoint();
    if (cp && !cp.resumed) {
      cp.resumed = true;
      const tmpPath = `${CHECKPOINT_PATH}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(cp, null, 2), 'utf8');
      fs.renameSync(tmpPath, CHECKPOINT_PATH);
    }
  } catch (err: any) {
    console.warn('[SessionCheckpoint] Failed to mark checkpoint resumed:', err.message);
  }
}

/**
 * Deletes the checkpoint file once restoration is complete.
 */
export function clearSessionCheckpoint(): void {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      fs.unlinkSync(CHECKPOINT_PATH);
    }
  } catch (_) {}
}

