import { spawn, execSync, ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { config } from '../config/index.js';

export interface TunnelStatus {
  isRunning: boolean;
  url: string | null;
  mode: 'quick' | 'token';
  customDomain: string | null;
  tokenConfigured: boolean;
  autostart: boolean;
  startedAt: number | null;
  error: string | null;
}

class CloudflareTunnelService {
  private static instance: CloudflareTunnelService;
  private childProcess: ChildProcess | null = null;
  private isRunning: boolean = false;
  private publicUrl: string | null = null;
  private currentMode: 'quick' | 'token' = 'quick';
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private isShuttingDown: boolean = false;

  private constructor() {}

  public static getInstance(): CloudflareTunnelService {
    if (!CloudflareTunnelService.instance) {
      CloudflareTunnelService.instance = new CloudflareTunnelService();
    }
    return CloudflareTunnelService.instance;
  }

  /**
   * Reads settings from app_settings table
   */
  private async getSettings(): Promise<{ token: string; customDomain: string; autostart: boolean }> {
    try {
      const db = await dbManager.getConnection();
      const rows = await db.all(
        `SELECT key, value FROM app_settings WHERE key IN ('cloudflare_tunnel_token', 'cloudflare_tunnel_custom_domain', 'cloudflare_tunnel_autostart')`
      );
      const map: Record<string, string> = {};
      for (const r of rows) map[r.key] = r.value;

      return {
        token: (map['cloudflare_tunnel_token'] || '').trim(),
        customDomain: (map['cloudflare_tunnel_custom_domain'] || '').trim(),
        autostart: map['cloudflare_tunnel_autostart'] === '1'
      };
    } catch {
      return { token: '', customDomain: '', autostart: false };
    }
  }

  /**
   * Check which local port is responsive (Vite 5173 or Backend 5174)
   */
  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        resolve(true);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Resolves the best available cloudflared binary on the current OS
   */
  private resolveBinary(): { binary: string; spawnArgsPrefix: string[]; useShell: boolean } {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      const candidates = [
        path.join(process.cwd(), 'node_modules', '.bin', 'cloudflared.exe'),
        path.join(process.cwd(), 'cloudflared.exe')
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return { binary: p, spawnArgsPrefix: [], useShell: false };
      }

      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) {
        const npxDir = path.join(localAppData, 'npm-cache', '_npx');
        if (fs.existsSync(npxDir)) {
          try {
            const dirs = fs.readdirSync(npxDir);
            for (const d of dirs) {
              const binPath = path.join(npxDir, d, 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');
              if (fs.existsSync(binPath)) {
                return { binary: binPath, spawnArgsPrefix: [], useShell: false };
              }
            }
          } catch (_) {}
        }
      }
      return { binary: 'npx.cmd', spawnArgsPrefix: ['-y', 'cloudflared'], useShell: true };
    }
    return { binary: 'cloudflared', spawnArgsPrefix: [], useShell: false };
  }

  /**
   * Initializes the service on server boot.
   * Auto-starts the tunnel if cloudflare_tunnel_autostart === '1'
   */
  public async init(): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (settings.autostart) {
        console.log('[CloudflareTunnel] Autostart is enabled. Launching online store tunnel in 5s...');
        setTimeout(() => {
          this.start().catch((err) => {
            console.error('[CloudflareTunnel] Autostart failed:', err);
          });
        }, 5000);
      }
    } catch (err) {
      console.warn('[CloudflareTunnel] Init warning:', err);
    }
  }

  /**
   * Starts the Cloudflare Tunnel
   */
  public async start(): Promise<TunnelStatus> {
    if (this.isRunning && this.childProcess) {
      return this.getStatus();
    }

    this.isShuttingDown = false;
    this.lastError = null;

    const settings = await this.getSettings();
    const hasToken = !!settings.token;
    this.currentMode = hasToken ? 'token' : 'quick';

    let args: string[] = [];

    if (hasToken) {
      // Named tunnel with custom domain
      args = ['tunnel', 'run', '--token', settings.token];
      if (settings.customDomain) {
        this.publicUrl = settings.customDomain.startsWith('http')
          ? settings.customDomain
          : `https://${settings.customDomain}`;
      }
    } else {
      // Quick tunnel mode
      // Always target the backend server (port 5174 / 5175) which serves the production frontend build,
      // API endpoints, product images (/products), and uploads (/uploads) reliably without Vite dev server restrictions.
      let targetPort = config.port || parseInt(process.env.PORT || '5175', 10);
      const isTargetActive = await this.checkPort(targetPort);
      if (!isTargetActive) {
        const is5175 = await this.checkPort(5175);
        if (is5175) {
          targetPort = 5175;
        } else {
          const is5174 = await this.checkPort(5174);
          if (is5174) targetPort = 5174;
        }
      }
      const localTarget = `http://127.0.0.1:${targetPort}`;
      const hostHeader = `127.0.0.1:${targetPort}`;

      args = [
        'tunnel',
        '--url', localTarget,
        '--http-host-header', hostHeader
      ];
    }

    const isWindows = process.platform === 'win32';
    if (isWindows) {
      try {
        execSync('taskkill /F /IM cloudflared.exe', { stdio: 'ignore' });
      } catch (_) {}
    }

    const { binary, spawnArgsPrefix, useShell } = this.resolveBinary();
    const spawnArgs = [...spawnArgsPrefix, ...args];

    console.log(`[CloudflareTunnel] Spawning cloudflared (${binary}) in ${this.currentMode} mode...`);

    try {
      this.childProcess = spawn(binary, spawnArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
        detached: false
      });

      this.isRunning = true;
      this.startedAt = Date.now();

      const parseOutput = (chunk: Buffer) => {
        const text = chunk.toString();

        if (this.currentMode === 'quick') {
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match) {
            this.publicUrl = match[0];
            console.log(`[CloudflareTunnel] Live quick tunnel established: ${this.publicUrl}`);
            this.persistLastUrl(this.publicUrl);
            this.broadcastStatus();
          }
        }

        // Detect errors
        if (text.includes('ERR ') || text.includes('Error:')) {
          const errLine = text.split('\n').find(l => l.includes('ERR') || l.includes('Error:'));
          if (errLine && !errLine.includes('context canceled')) {
            this.lastError = errLine.trim();
          }
        }
      };

      this.childProcess.stdout?.on('data', parseOutput);
      this.childProcess.stderr?.on('data', parseOutput);

      this.childProcess.on('error', (err) => {
        console.error('[CloudflareTunnel] Process error:', err.message);
        this.lastError = err.message;
        this.isRunning = false;
        this.publicUrl = null;
        this.broadcastStatus();
      });

      this.childProcess.on('exit', (code, signal) => {
        console.log(`[CloudflareTunnel] Process exited (code: ${code}, signal: ${signal})`);
        this.isRunning = false;
        this.childProcess = null;
        if (!this.isShuttingDown) {
          this.publicUrl = null;
        }
        this.broadcastStatus();
      });

      this.broadcastStatus();

      return this.getStatus();
    } catch (err: any) {
      console.error('[CloudflareTunnel] Failed to spawn cloudflared:', err);
      this.isRunning = false;
      this.lastError = err.message;
      return this.getStatus();
    }
  }

  /**
   * Stops the active tunnel cleanly
   */
  public async stop(): Promise<TunnelStatus> {
    this.isShuttingDown = true;
    if (this.childProcess && !this.childProcess.killed) {
      try {
        if (process.platform === 'win32') {
          try {
            execSync('taskkill /F /IM cloudflared.exe', { stdio: 'ignore' });
          } catch (_) {}
        } else {
          this.childProcess.kill('SIGINT');
        }
      } catch (e) {
        console.warn('[CloudflareTunnel] Error terminating process:', e);
      }
    }
    this.childProcess = null;
    this.isRunning = false;
    this.publicUrl = null;
    this.startedAt = null;
    this.broadcastStatus();
    return this.getStatus();
  }

  /**
   * Returns current tunnel status
   */
  public async getStatus(): Promise<TunnelStatus> {
    const settings = await this.getSettings();
    return {
      isRunning: this.isRunning,
      url: this.publicUrl,
      mode: this.currentMode,
      customDomain: settings.customDomain || null,
      tokenConfigured: !!settings.token,
      autostart: settings.autostart,
      startedAt: this.startedAt,
      error: this.lastError
    };
  }

  /**
   * Configures Cloudflare Tunnel settings in app_settings
   */
  public async configure(data: {
    token?: string;
    customDomain?: string;
    autostart?: boolean;
  }): Promise<TunnelStatus> {
    const db = await dbManager.getConnection();

    if (data.token !== undefined) {
      await db.run(
        `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('cloudflare_tunnel_token', ?)`,
        [data.token.trim()]
      );
    }
    if (data.customDomain !== undefined) {
      await db.run(
        `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('cloudflare_tunnel_custom_domain', ?)`,
        [data.customDomain.trim()]
      );
    }
    if (data.autostart !== undefined) {
      await db.run(
        `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('cloudflare_tunnel_autostart', ?)`,
        [data.autostart ? '1' : '0']
      );
    }

    return this.getStatus();
  }

  private async persistLastUrl(url: string) {
    try {
      const db = await dbManager.getConnection();
      await db.run(
        `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('cloudflare_tunnel_last_url', ?)`,
        [url]
      );
    } catch {}
  }

  private async broadcastStatus() {
    try {
      const status = await this.getStatus();
      eventService.broadcast('tunnel_status_changed', status);
    } catch {}
  }
}

export const cloudflareTunnelService = CloudflareTunnelService.getInstance();
export default cloudflareTunnelService;
