import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  tests: 'tests/**/*.e2e.ts',
  targets: [
    {
      engine: web({
        browser: 'chromium',
        viewport: { width: 1366, height: 768 },
      }),
      app: {
        url: 'http://127.0.0.1:5174',
      },
    },
  ],
  timeout: 120_000,
} satisfies E2EConfig;
