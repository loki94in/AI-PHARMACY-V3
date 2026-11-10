import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { downloadFile } from '../src/services/autoUpdateService.js';

function sha256Buf(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('Auto-Update Parallel Range Downloader', () => {
  const payload = crypto.randomBytes(3 * 1024 * 1024 + 137); // > 2 MB threshold for parallel ranges
  const payloadHash = sha256Buf(payload);
  let server: http.Server;
  let baseUrl: string;
  let tempDir: string;
  let seenRangeRequests = 0;
  let dropSliceOnce = true;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pharmacy-dl-test-'));
    server = http.createServer((req, res) => {
      const urlPath = req.url || '/';

      // Redirect route -> /cdn/bundle.zip
      if (urlPath === '/redirect/bundle.zip') {
        res.writeHead(302, { Location: '/cdn/bundle.zip' });
        res.end();
        return;
      }

      // 404 error route
      if (urlPath === '/missing.zip') {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      // Single-stream fallback route (HEAD unsupported, no Accept-Ranges)
      if (urlPath === '/no-ranges.zip') {
        if (req.method === 'HEAD') {
          res.writeHead(405);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Length': String(payload.length) });
        res.end(payload);
        return;
      }

      // Parallel-capable CDN route with simulated mid-stream drop on one chunk
      if (urlPath === '/cdn/bundle.zip') {
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(payload.length),
          });
          res.end();
          return;
        }

        const rangeHeader = req.headers.range;
        if (rangeHeader) {
          seenRangeRequests++;
          const m = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
          if (!m) {
            res.writeHead(416);
            res.end();
            return;
          }
          const start = parseInt(m[1], 10);
          const end = Math.min(payload.length - 1, parseInt(m[2], 10));
          const slice = payload.subarray(start, end + 1);
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${payload.length}`,
            'Content-Length': String(slice.length),
            'Accept-Ranges': 'bytes',
          });

          // Simulate one transient mid-chunk drop on the first non-zero slice to verify chunk resume
          if (dropSliceOnce && start > 0) {
            dropSliceOnce = false;
            const half = Math.floor(slice.length / 2);
            res.write(slice.subarray(0, half), () => {
              req.socket.destroy();
            });
            return;
          }

          res.end(slice);
          return;
        }

        res.writeHead(200, { 'Content-Length': String(payload.length) });
        res.end(payload);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('downloads via parallel HTTP Range chunks across redirects and resumes dropped slices', async () => {
    seenRangeRequests = 0;
    dropSliceOnce = true;
    const dest = path.join(tempDir, 'parallel.zip');
    const progressEvents: Array<{ downloaded: number; total: number }> = [];

    await downloadFile(`${baseUrl}/redirect/bundle.zip`, dest, payload.length, (downloaded, total) => {
      progressEvents.push({ downloaded, total });
    });

    expect(seenRangeRequests).toBeGreaterThanOrEqual(4);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(`${dest}.tmp`)).toBe(false);

    const written = fs.readFileSync(dest);
    expect(written.length).toBe(payload.length);
    expect(sha256Buf(written)).toBe(payloadHash);
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    expect(progressEvents[progressEvents.length - 1]).toEqual({
      downloaded: payload.length,
      total: payload.length,
    });
  });

  it('falls back cleanly to single-stream GET when HEAD/Ranges are unsupported', async () => {
    const dest = path.join(tempDir, 'single.zip');
    await downloadFile(`${baseUrl}/no-ranges.zip`, dest, payload.length);

    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(`${dest}.tmp`)).toBe(false);
    expect(sha256Buf(fs.readFileSync(dest))).toBe(payloadHash);
  });

  it('cleans up .tmp file on HTTP 404 failure', async () => {
    const dest = path.join(tempDir, 'failed.zip');
    await expect(downloadFile(`${baseUrl}/missing.zip`, dest, payload.length)).rejects.toThrow(/HTTP 404/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.tmp`)).toBe(false);
  });
});
