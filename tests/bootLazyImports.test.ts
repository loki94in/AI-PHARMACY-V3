import fs from 'fs';
import path from 'path';

// Bug P2-81: these modules are imported during boot (refill check, email poller, monthly-report
// check, catalog worker, WhatsApp/Telegram helpers). A top-level import of a heavy library in any
// of them blocked the event loop for up to ~1.5 s right when the POS screen loads its first data
// (whatsapp-web.js 0.74 s, node-telegram-bot-api 0.42 s, jimp/onnx, pdfkit, xlsx, mailparser).
// They must load those libraries inside the function that uses them. `import type` is fine.
const HEAVY = [
  'whatsapp-web.js', 'node-telegram-bot-api', 'imap-simple', 'mailparser', 'xlsx', 'pdfkit',
  './aiCameraService.js', './services/aiCameraService.js', './services/imageArchiveService.js', '../extractor.js',
];
const BOOT_PATH_FILES = [
  'src/whatsappClient.ts',
  'src/telegramBot.ts',
  'src/services/emailService.ts',
  'src/services/monthlyReportService.ts',
  'src/worker/catalogWorker.ts',
];

describe('boot-path modules load heavy libraries lazily', () => {
  for (const rel of BOOT_PATH_FILES) {
    test(`${rel} has no top-level value import of a heavy library`, () => {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      const offenders = src
        .split('\n')
        .filter((line) => /^import\s/.test(line) && !/^import\s+type\s/.test(line))
        .filter((line) => HEAVY.some((pkg) => line.includes(`'${pkg}'`)));
      expect(offenders).toEqual([]);
    });
  }
});
