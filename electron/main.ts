/**
 * Electron Main Process — AI Pharmacy OS
 *
 * Strategy (ponytail: minimum that works):
 *  1. Enforce single-instance lock so duplicate instances don't collide on port 5175.
 *  2. Spawn the existing Node.js backend as a child process (no refactor needed).
 *  3. Poll the health endpoint until the backend is ready.
 *  4. Create a BrowserWindow that loads the UI — replacing the old Chrome --app= window.
 *  5. When the window closes, kill the backend and quit Electron.
 *
 * Dev:  npm run electron:dev
 * Prod: Packaged Electron binary with PharmacyBackend.exe child process.
 */

import { app, BrowserWindow, shell } from 'electron';
import { spawn, exec, execSync, ChildProcess } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import http from 'http';

// Resolve __dirname safely across both CJS and ESM
const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(process.argv[1] || process.cwd());

// Enforce single unified application identity across Windows Start Menu, Taskbar & Notifications
app.name = 'AI Pharmacy OS';
if (process.platform === 'win32') {
  app.setAppUserModelId('com.aipharmacy.os');
  try {
    const userPrograms = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const rogueShortcut = path.join(userPrograms, 'Electron.lnk');
    if (fs.existsSync(rogueShortcut)) {
      fs.unlinkSync(rogueShortcut);
      console.log('[ElectronMain] Purged rogue Electron.lnk from Start Menu.');
    }
  } catch (_) {}
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5175;
const BACKEND_URL = `http://127.0.0.1:${PORT}`;
const HEALTH_URL = `${BACKEND_URL}/api/health`;

let backendProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// Single-instance lock to protect port 5175
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[ElectronMain] Another instance is already running. Quitting duplicate.');
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/** Clean leftover browser profile locks so Chromium / Puppeteer never launch locked */
function cleanAllSessionLocks(targetDir: string): void {
  const sessionLocks = [
    path.join(targetDir, '.wwebjs_auth', 'session', 'devtoolsactiveport'),
    path.join(targetDir, '.wwebjs_auth', 'session', 'Default', 'devtoolsactiveport'),
    path.join(targetDir, '.wwebjs_auth', 'session', 'lockfile'),
    path.join(targetDir, '.wwebjs_auth', 'session', 'SingletonLock'),
    path.join(targetDir, 'data', 'pharmarack_profile', 'SingletonLock'),
    path.join(targetDir, 'data', 'pharmarack_profile', 'lockfile'),
    path.join(targetDir, 'data', 'pharmarack_profile', 'devtoolsactiveport'),
  ];
  for (const lock of sessionLocks) {
    try {
      if (fs.existsSync(lock)) fs.unlinkSync(lock);
    } catch (_) {}
  }
}

/** Forcibly reclaim port if occupied by any stale/zombie process from previous runs.
 *  Async: a blocking netstat on the main thread held back the window's first paint (bug P2-81). */
async function reclaimPort(port: number): Promise<void> {
  if (process.platform !== 'win32') return;
  const run = promisify(exec);
  try {
    const { stdout } = await run(`netstat -ano -p tcp | findstr :${port} | findstr LISTENING`, { timeout: 1500 });
    const lines = stdout.trim().split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pidStr = parts[parts.length - 1];
      const pid = parseInt(pidStr, 10);
      if (pid && pid !== process.pid) {
        console.log(`[ElectronMain] Port ${port} is occupied by stale PID ${pid}. Terminating process tree...`);
        try {
          await run(`taskkill /F /T /PID ${pid}`, { timeout: 2000 });
        } catch (_) {}
      }
    }
  } catch (_) {
    // Port is already free
  }
}

// Shown the moment the window opens, while the backend starts (bug P2-81). Plain inline HTML: no
// network, no framework. Kept cheap for CPU-only rendering (No-GPU contract): one small spinner.
const SPLASH_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>AI Pharmacy OS</title>
<style>html,body{margin:0;height:100%;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
body{display:flex;align-items:center;justify-content:center}.box{text-align:center}
.spin{width:28px;height:28px;margin:0 auto 14px;border:3px solid #334155;border-top-color:#38bdf8;border-radius:50%;animation:s .9s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}h1{margin:0 0 6px;font-size:18px;color:#38bdf8;font-weight:600}p{margin:0;font-size:13px;color:#94a3b8}</style></head>
<body><div class="box"><div class="spin"></div><h1>AI Pharmacy OS</h1><p>Starting…</p></div></body></html>`);

let backendReady = false;

// OWNER POLICY (2026-09-30): the app must never need a graphics card. It must run on any PC,
// including ones with only the CPU's integrated graphics. Everything is drawn by the CPU, so the UI
// must stay cheap to draw (see frontend/AGENTS.md "Dropdown Scroll Performance Rule").
// Guardrail E1 (scripts/performance-guardrails.mjs) blocks removing these lines or adding GPU-forcing switches.
app.disableHardwareAcceleration();

// Pure software CPU rasterization & rendering switches (Zero GPU footprint)
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('use-gl', 'swiftshader');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

/** Poll the health endpoint until the backend is ready (max 30s) */
function waitForBackend(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function probe() {
      http
        .get(HEALTH_URL, (res) => {
          res.resume(); // drain
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            retry();
          }
        })
        .on('error', () => retry());
    }
    function retry() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Backend did not start within ${timeoutMs}ms`));
        return;
      }
      setTimeout(probe, 50); // a local probe costs nothing; 250 ms added up to a quarter second of blank wait
    }
    probe();
  });
}

/** Launch the backend Node process with ELECTRON_MODE=true so it skips chromeBrowser.launchAppBrowser */
function startBackend(): ChildProcess {
  const isPackaged = app.isPackaged;
  const exeDir = path.dirname(process.execPath);

  // 1. Packaged: Dedicated PharmacyBackend.exe beside the main executable
  const packagedBackendExe = path.join(exeDir, 'PharmacyBackend.exe');

  // 2. Packaged: dist-pkg/server.cjs inside app resources or app root
  const resourceServerCjs = path.join(process.resourcesPath || exeDir, 'app', 'dist-pkg', 'server.cjs');
  const directServerCjs = path.join(exeDir, 'dist-pkg', 'server.cjs');

  let cmd: string;
  let args: string[] = [];
  let useShell = false;
  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ELECTRON_MODE: 'true',
    PORT: String(PORT),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=512`.trim(),
  };

  if (isPackaged && fs.existsSync(packagedBackendExe)) {
    cmd = packagedBackendExe;
    args = [];
  } else if (isPackaged && fs.existsSync(resourceServerCjs)) {
    // Run Electron itself as a Node interpreter for server.cjs
    cmd = process.execPath;
    args = [resourceServerCjs];
    childEnv.ELECTRON_RUN_AS_NODE = '1';
  } else if (isPackaged && fs.existsSync(directServerCjs)) {
    cmd = process.execPath;
    args = [directServerCjs];
    childEnv.ELECTRON_RUN_AS_NODE = '1';
  } else {
    // Development mode: spawn tsx src/bootstrap.ts
    const rootDir = path.resolve(currentDir, '..');
    const isWin = process.platform === 'win32';
    cmd = isWin ? 'npx.cmd' : 'npx';
    args = ['tsx', path.join(rootDir, 'src', 'bootstrap.ts')];
    useShell = isWin;
  }

  console.log(`[ElectronMain] Spawning backend: ${cmd} ${args.join(' ')}`);

  // Silent process spawn: windowsHide=true prevents Windows from allocating a console window,
  // and stdio: ['ignore', 'pipe', 'pipe'] redirects output silently to backend.log
  const child = spawn(cmd, args, {
    cwd: exeDir,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
    windowsHide: true,
  });

  // Windows Process Priority: elevate backend process to Above Normal priority
  if (process.platform === 'win32' && child.pid) {
    try {
      import('os').then((os) => {
        if (os.constants?.priority?.PRIORITY_ABOVE_NORMAL && child.pid) {
          os.setPriority(child.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
          console.log(`[ElectronMain] Set backend child PID ${child.pid} priority to Above Normal.`);
        }
      }).catch(() => {});
    } catch (_) {}
  }

  const logDir = path.join(exeDir, 'data');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (_) {}
  const logFile = path.join(logDir, 'backend.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  if (child.stdout) {
    child.stdout.pipe(logStream);
    if (!isPackaged) {
      child.stdout.on('data', (d) => process.stdout.write(`[Backend] ${d}`));
    }
  }
  if (child.stderr) {
    child.stderr.pipe(logStream);
    if (!isPackaged) {
      child.stderr.on('data', (d) => process.stderr.write(`[Backend ERR] ${d}`));
    }
  }

  child.on('close', () => {
    try {
      logStream.end();
    } catch (_) {}
  });

  child.on('error', (err) => {
    console.error('[ElectronMain] Backend process error:', err.message);
  });

  return child;
}

function createWindow() {
  const possiblePreloads = [
    path.join(currentDir, 'preload.cjs'),
    path.join(currentDir, 'preload.js'),
    path.join(currentDir, 'preload.ts'),
  ];
  const preloadPath = possiblePreloads.find((p) => fs.existsSync(p));

  const possibleIcons = [
    path.join(path.dirname(process.execPath), 'app.ico'),
    path.join(path.dirname(process.execPath), 'packaging', 'app.ico'),
    path.join(currentDir, '..', 'packaging', 'app.ico'),
    path.join(process.resourcesPath || path.dirname(process.execPath), '..', 'app.ico'),
  ];
  const windowIcon = possibleIcons.find((p) => fs.existsSync(p));

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 868,
    minWidth: 1024,
    minHeight: 700,
    show: false, // show after ready-to-show to avoid white flash
    title: 'AI Pharmacy OS',
    icon: windowIcon,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: true, // Allow Chromium to sleep idle/hidden tabs and eliminate GPU overheating
    },
  });

  // Open the app in maximized mode (same as old Chrome --start-fullscreen)
  mainWindow.maximize();

  // Visual Safety Fallback: Ensure the window becomes visible within 2.5s even if ready-to-show is slow
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('[ElectronMain] Safety fallback triggered: displaying main window.');
      mainWindow.show();
    }
  }, 2500);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallback);
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  // The splash paints at once; the React SPA (served by our Express backend) replaces it as soon as
  // the backend answers. A window re-created later (macOS 'activate') goes straight to the app.
  mainWindow.loadURL(backendReady ? BACKEND_URL : SPLASH_URL);

  // Open external links in system browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(BACKEND_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Elevate Electron main process priority on Windows
  if (process.platform === 'win32') {
    try {
      import('os').then((os) => {
        if (os.constants?.priority?.PRIORITY_ABOVE_NORMAL) {
          os.setPriority(process.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
          console.log('[ElectronMain] Set Electron main process priority to Above Normal.');
        }
      }).catch(() => {});
    } catch (_) {}
  }

  // Priority Shield: If a background development server is running on port 5174, request it to yield WhatsApp
  try {
    const yieldReq = http.request('http://127.0.0.1:5174/api/messaging/yield', { method: 'POST', timeout: 800 }, (res) => {
      res.resume();
      console.log('[ElectronMain] Notified background dev server on port 5174 to yield WhatsApp session.');
    });
    yieldReq.on('error', () => {/* port 5174 not running, expected in standalone prod */});
    yieldReq.end();
  } catch (_) {}

  // Window first (bug P2-81): the user sees the app open immediately instead of an empty desktop
  // for the whole backend start-up; the splash is swapped for the SPA once the backend answers.
  createWindow();

  // Startup Sanitation: Reclaim port 5175 if occupied by any lingering zombie, and clear session locks
  const exeDir = path.dirname(process.execPath);
  await reclaimPort(PORT);
  if (!mainWindow) return; // closed on the splash: the app is quitting, don't start an orphan backend
  cleanAllSessionLocks(exeDir);

  console.log('[ElectronMain] Starting AI Pharmacy OS backend...');
  backendProcess = startBackend();

  try {
    await waitForBackend();
    backendReady = true;
    console.log('[ElectronMain] Backend ready. Loading the app...');
    mainWindow?.loadURL(BACKEND_URL); // no window = it was closed on the splash and the app is quitting
  } catch (err) {
    console.error('[ElectronMain] Backend failed to start:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  console.log('[ElectronMain] All windows closed. Synchronously shutting down backend & child processes...');
  if (backendProcess && backendProcess.pid) {
    const pid = backendProcess.pid;
    try {
      if (process.platform === 'win32') {
        // Synchronous process-tree kill: forcibly terminates backend AND all child headless Chrome/Node instances
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 3000 });
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch (_) {}
  }

  // Clean session profile locks synchronously on exit
  const exeDir = path.dirname(process.execPath);
  cleanAllSessionLocks(exeDir);

  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
