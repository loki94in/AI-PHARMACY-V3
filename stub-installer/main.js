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
ipcMain.handle('download-and-install', async (event, { downloadUrl, pharmacyName }) => {
  const tmpPath = path.join(os.tmpdir(), 'ai-pharmacy-setup.exe');

  try {
    // Download with progress
    await downloadFile(downloadUrl, tmpPath, (pct) => {
      win.webContents.send('download-progress', pct);
    });

    // Run installer
    win.webContents.send('install-status', 'Installing...');
    await runInstaller(tmpPath);
    win.webContents.send('install-status', 'done');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
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
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
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

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const file   = fs.createWriteStream(dest);

    const req = lib.get(url, (res) => {
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;

      res.on('data', chunk => {
        downloaded += chunk.length;
        if (total > 0) onProgress(Math.round((downloaded / total) * 100));
        file.write(chunk);
      });

      res.on('end', () => { file.end(); resolve(); });
      res.on('error', reject);
    });

    req.on('error', (err) => { file.destroy(); fs.unlinkSync(dest); reject(err); });
  });
}

function runInstaller(exePath) {
  return new Promise((resolve, reject) => {
    // /S = silent install (NSIS standard flag)
    exec(`"${exePath}" /S`, { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Installer exited with error: ${err.message}`));
      else resolve();
    });
  });
}
