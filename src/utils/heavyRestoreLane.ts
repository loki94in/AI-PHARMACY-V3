/**
 * Heavy Restore Lane — serialization for heavy Chromium session restores (P2-105)
 *
 * Guarantees that WhatsApp boot/session restore and Pharmarack session restore
 * NEVER launch concurrent headless Chromium browsers and disk profile copies simultaneously
 * on the 12 GB / 4-core machine.
 */

let activeRestoreTag: string | null = null;
let restoreChain: Promise<unknown> = Promise.resolve();

export async function runHeavyRestore<T>(
  tag: string,
  fn: () => Promise<T>
): Promise<T> {
  const queuedAt = performance.now();
  if (activeRestoreTag) {
    console.log(`[HeavyRestoreLane] '${tag}' queued behind active restore '${activeRestoreTag}'.`);
  }

  const exec = restoreChain.then(async () => {
    const waitedMs = Math.round(performance.now() - queuedAt);
    if (waitedMs > 5000) {
      console.log(`[HeavyRestoreLane] '${tag}' waited ${waitedMs}ms in restore lane before starting.`);
    }
    activeRestoreTag = tag;
    try {
      return await fn();
    } finally {
      activeRestoreTag = null;
    }
  });

  restoreChain = exec.catch(() => {});
  return await exec;
}

export function isHeavyRestoreBusy(): boolean {
  return activeRestoreTag !== null;
}
