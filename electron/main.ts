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
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

// Resolve __dirname safely across both CJS and ESM
const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(process.argv[1] || process.cwd());

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
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Chromium Performance & Hardware Acceleration Switches (Crucial for Low-Spec / Integrated Display PCs)
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
app.commandLine.appendSwitch('disable-background-timer-throttling');

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
      setTimeout(probe, 250);
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
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
    windowsHide: true,
  });

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
      backgroundThrottling: false, // Prevent frame rate drops and timer clamping
    },
  });

  // Open the app in maximized mode (same as old Chrome --start-fullscreen)
  mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  // Load the React SPA served by our Express backend
  mainWindow.loadURL(BACKEND_URL);

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
  console.log('[ElectronMain] Starting AI Pharmacy OS backend...');
  backendProcess = startBackend();

  try {
    await waitForBackend();
    console.log('[ElectronMain] Backend ready. Creating window...');
    createWindow();
  } catch (err) {
    console.error('[ElectronMain] Backend failed to start:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  console.log('[ElectronMain] All windows closed. Shutting down backend...');
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
    // Force kill after 3s if graceful shutdown doesn't complete
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill('SIGKILL');
      }
    }, 3000);
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
