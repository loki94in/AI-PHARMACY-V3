import {
  runHeavyRestore,
  isHeavyRestoreBusy
} from '../src/utils/heavyRestoreLane.js';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

describe('Heavy Restore Lane (P2-105)', () => {
  test('serializes concurrent Chromium session restores sequentially', async () => {
    const events: string[] = [];

    const restorePharmarack = runHeavyRestore('pharmarack_session_restore', async () => {
      events.push('pharmarack_start');
      await delay(40);
      events.push('pharmarack_end');
      return 'pharmarack_ok';
    });

    const restoreWhatsApp = runHeavyRestore('whatsapp_boot_restore', async () => {
      events.push('whatsapp_start');
      await delay(20);
      events.push('whatsapp_end');
      return 'whatsapp_ok';
    });

    const [res1, res2] = await Promise.all([restorePharmarack, restoreWhatsApp]);

    expect(res1).toBe('pharmarack_ok');
    expect(res2).toBe('whatsapp_ok');
    expect(events).toEqual([
      'pharmarack_start',
      'pharmarack_end',
      'whatsapp_start',
      'whatsapp_end'
    ]);
  });

  test('lane continues processing subsequent restores even if a prior restore fails', async () => {
    await expect(
      runHeavyRestore('failing_restore', async () => {
        throw new Error('Chromium crash simulation');
      })
    ).rejects.toThrow('Chromium crash simulation');

    const nextRestore = await runHeavyRestore('subsequent_restore', async () => 'recovered');
    expect(nextRestore).toBe('recovered');
    expect(isHeavyRestoreBusy()).toBe(false);
  });
});
