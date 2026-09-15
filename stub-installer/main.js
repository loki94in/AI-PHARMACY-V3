/**
 * Stub Installer — Electron Main Process
 *
 * Flow:
 *  1. Opens a small, non-resizable GUI window
 *  2. User enters License ID + License Key
 *  3. Validates against LICENSE_SERVER_URL
 *  4. Downloads the full AI Pharmacy installer from the server
 *  5. Runs the installer silently
 *  6. Shows "Installation Complete" and exits
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const https = require('https');
const http = require('http');
const dns = require('dns');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');
const crypto = require('crypto');

// ── Config ────────────────────────────────────────────────────────────────────
const LICENSE_SERVER = 'https://ai-pharmacy-license.vercel.app';
const APP_NAME       = 'AI Pharmacy';

// ── Machine fingerprint (same algorithm as licenseService.ts) ─────────────────
function getMachineId() {
  const nets = os.networkInterfaces();
  let mac = '';
  for (const name of Object.keys(nets)) {
    for (const net of (nets[name] || [])) {
      if (!net.internal && net.mac !== '00:00:00:00:00:00') { mac = net.mac; break; }
    }
    if (mac) break;
  }
  let winGuid = '';
  try {
    const out = execSync(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 3000 }
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+(.+)/);
    if (m) winGuid = m[1].trim();
  } catch { /* non-Windows */ }
  return crypto.createHash('sha256').update(`${mac}|${winGuid}`).digest('hex').substring(0, 32);
}

function getMachineName() {
  try { return execSync('hostname', { encoding: 'utf8', timeout: 2000 }).trim(); } catch { return 'Unknown PC'; }
}

// ── Window ────────────────────────────────────────────────────────────────────
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    frame: false,          // custom titlebar in renderer
    titleBarStyle: 'hidden',
    backgroundColor: '#0f1117',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('renderer.html');
  // win.webContents.openDevTools(); // uncomment for debugging
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ── IPC Handlers ──────────────────────────────────────────────────────────────

/** Step 1: Validate license ID + key against Vercel */
ipcMain.handle('validate-license', async (event, { licenseId, licenseKey }) => {
  const machineId   = getMachineId();
  const machineName = getMachineName();

  try {
    const result = await httpPost(`${LICENSE_SERVER}/api/license/activate`, {
      licenseId: licenseId.trim().toUpperCase(),
      licenseKey: licenseKey.trim().toUpperCase(),
      machineId,
      machineName,
    });
    return { success: true, pharmacyName: result.pharmacyName };
  } catch (err) {
    return { success: false, error: err.message || 'Validation failed' };
  }
});

/** Step 2: Download + install the full app */
ipcMain.handle('download-and-install', async (event, { downloadUrl, pharmacyName, licenseId, licenseKey }) => {
  const tmpPath = path.join(os.tmpdir(), 'ai-pharmacy-setup.exe');

  try {
    // Download with progress
    await downloadFile(downloadUrl, tmpPath, (pct) => {
      win?.webContents.send('download-progress', pct);
    });

    // Run installer
    win?.webContents.send('install-status', 'Installing AI Pharmacy...');
    await runInstaller(tmpPath);

    // Bootstrap license file in installed directory if present
    try {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const targetDir = path.join(localAppData, 'AI Pharmacy OS');
      if (fs.existsSync(targetDir)) {
        const licFile = path.join(targetDir, 'license.json');
        fs.writeFileSync(licFile, JSON.stringify({
          licenseId: licenseId || '',
          pharmacyName: pharmacyName || '',
          activatedAt: new Date().toISOString()
        }, null, 2));
      }
    } catch { /* non-critical */ }

    win?.webContents.send('install-status', 'done');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
});

/** Step 3: Launch installed app */
ipcMain.on('launch-app', () => {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const exePath = path.join(localAppData, 'AI Pharmacy OS', 'PharmacyOS.exe');
  const batPath = path.join(localAppData, 'AI Pharmacy OS', 'RUN-PharmacyOS.bat');

  if (fs.existsSync(exePath)) {
    shell.openPath(exePath).catch(() => {});
  } else if (fs.existsSync(batPath)) {
    shell.openPath(batPath).catch(() => {});
  }
  setTimeout(() => app.quit(), 1000);
});

/** Close / minimise */
ipcMain.on('close-app', () => app.quit());
ipcMain.on('minimize-app', () => win?.minimize());

// ── Helpers ───────────────────────────────────────────────────────────────────

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data   = JSON.stringify(body);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const req = lib.request(parsed.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-Pharmacy-Installer/1.0.0'
      },
    }, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) return reject(new Error(parsed.error || `Server error ${res.statusCode}`));
          resolve(parsed);
        } catch { reject(new Error('Invalid server response')); }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Connection timed out')); });
    req.write(data);
    req.end();
  });
}

// Set of known blackholed or failing IPs across ISPs (e.g. Jio 185.199.109.x)
const failedIps = new Set(['185.199.109.133', '185.199.109.153']);

/**
 * Resilient DNS lookup: resolves IPv4 addresses and filters out dead/blackholed IPs.
 * Ensures Fastly / GitHub release CDN routes to active POPs (.108, .110, .111).
 */
function resilientLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const isAll = typeof options === 'object' && options?.all;

  if (net.isIP(hostname)) {
    if (isAll) return cb(null, [{ address: hostname, family: net.isIPv6(hostname) ? 6 : 4 }]);
    return cb(null, hostname, net.isIPv6(hostname) ? 6 : 4);
  }

  dns.resolve4(hostname, (err, ips) => {
    if (err || !ips || ips.length === 0) {
      return dns.lookup(hostname, options, cb);
    }
    const goodIps = ips.filter(ip => !failedIps.has(ip) && !ip.startsWith('185.199.109.'));
    const candidates = goodIps.length > 0 ? goodIps : ips;

    if (isAll) {
      return cb(null, candidates.map(ip => ({ address: ip, family: 4 })));
    } else {
      return cb(null, candidates[0], 4);
    }
  });
}

/**
 * Detects if the full installer executable is already present locally on the machine
 * (e.g. copied to current dir, Downloads, Desktop, or project dist folder).
 */
function findLocalInstaller() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'AI-Pharmacy-OS-Portable-Setup-v0.1.0.exe'),
    path.join(process.cwd(), 'AI-Pharmacy-OS-Portable-Setup-v0.1.0.exe'),
    path.join(os.homedir(), 'Downloads', 'AI-Pharmacy-OS-Portable-Setup-v0.1.0.exe'),
    path.join(os.homedir(), 'Desktop', 'AI-Pharmacy-OS-Portable-Setup-v0.1.0.exe'),
    path.join(__dirname, '..', 'dist', 'installer', 'AI-Pharmacy-OS-Portable-Setup-v0.1.0.exe'),
    path.join(process.cwd(), 'dist', 'installer', 'AI-Pharmacy-OS-Portable-Setup-v0.1.0.exe'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.size > 200 * 1024 * 1024) {
          return { path: p, size: stat.size };
        }
      }
    } catch {}
  }
  return null;
}

function copyLocalWithProgress(src, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(src);
    const total = stat.size;
    let copied = 0;
    const read = fs.createReadStream(src);
    const write = fs.createWriteStream(dest);

    read.on('data', chunk => {
      copied += chunk.length;
      if (total > 0) onProgress(Math.min(100, Math.round((copied / total) * 100)));
    });

    write.on('finish', () => {
      onProgress(100);
      resolve();
    });

    read.on('error', (err) => {
      write.destroy();
      reject(err);
    });
    write.on('error', reject);
    read.pipe(write);
  });
}

/**
 * High-speed resilient download with automatic failover and local caching.
 */
function downloadFile(url, dest, onProgress) {
  const local = findLocalInstaller();
  if (local) {
    console.log('[installer] Found local package, installing from:', local.path);
    return copyLocalWithProgress(local.path, dest, onProgress);
  }

  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 3;

    function attemptDownload(currentUrl) {
      attempts++;
      function get(u, redirectCount = 0) {
        if (redirectCount > 10) {
          return reject(new Error('Too many HTTP redirects'));
        }

        const parsed = new URL(u);
        const lib    = parsed.protocol === 'https:' ? https : http;

        const req = lib.get(parsed.toString(), {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-Pharmacy-Installer/1.0.0',
            'Accept': '*/*'
          },
          lookup: resilientLookup
        }, (res) => {
          // Follow 301, 302, 307, 308 redirects (e.g. GitHub Releases -> AWS/Fastly CDN)
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, u).toString();
            return get(redirectUrl, redirectCount + 1);
          }

          if (res.statusCode !== 200) {
            return retryOrReject(new Error(`Download failed with HTTP status ${res.statusCode}`));
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;
          const file = fs.createWriteStream(dest);

          res.on('data', chunk => {
            downloaded += chunk.length;
            if (total > 0) onProgress(Math.round((downloaded / total) * 100));
            file.write(chunk);
          });

          res.on('end', () => {
            file.end();
            resolve();
          });

          res.on('error', (err) => {
            file.destroy();
            try { fs.unlinkSync(dest); } catch {}
            retryOrReject(err);
          });
        });

        req.setTimeout(12000, () => {
          req.destroy();
          retryOrReject(new Error('Connection timed out to download mirror'));
        });

        req.on('error', (err) => {
          try { fs.unlinkSync(dest); } catch {}
          retryOrReject(err);
        });
      }

      function retryOrReject(err) {
        if (attempts < maxAttempts) {
          console.warn(`[installer] Download attempt ${attempts} failed (${err.message}). Retrying...`);
          setTimeout(() => attemptDownload(currentUrl), 1500);
        } else {
          reject(err);
        }
      }

      get(currentUrl);
    }

    attemptDownload(url);
  });
}

function runInstaller(exePath) {
  return new Promise((resolve, reject) => {
    // /VERYSILENT /SUPPRESSMSGBOXES /NORESTART = Inno Setup silent flags
    exec(`"${exePath}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`, { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Installer exited with error: ${err.message}`));
      else resolve();
    });
  });
}
