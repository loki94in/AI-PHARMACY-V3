import https from 'https';
import { APP_VERSION } from './licenseService.js';
import { compareVersions } from './autoUpdateService.js';

export interface ReleaseHistoryItem {
  version: string;
  name: string;
  publishedAt: string;
  changelog: string;
  isNewerThanInstalled: boolean;
}

export interface UpdateHistoryResponse {
  installed: string;
  releases: ReleaseHistoryItem[];
  offline?: boolean;
}

const GITHUB_REPO = 'loki94in/AI-PHARMACY-V3';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let cachedHistory: UpdateHistoryResponse | null = null;
let cachedAt = 0;

interface GithubReleaseRow {
  tag_name?: string;
  name?: string;
  published_at?: string;
  body?: string;
}

function fetchGithubReleases(): Promise<GithubReleaseRow[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/releases?per_page=8`,
      method: 'GET',
      headers: {
        'User-Agent': 'AI-Pharmacy-Vercel-Updater/1.0',
        Accept: 'application/vnd.github.v3+json',
      },
      timeout: 4000,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        return reject(new Error(`GitHub API returned status ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk: Buffer | string) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            resolve(parsed as GithubReleaseRow[]);
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('GitHub API request timed out (4s)'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

export async function getUpdateHistory(forceRefresh = false): Promise<UpdateHistoryResponse> {
  const now = Date.now();
  if (!forceRefresh && cachedHistory && (now - cachedAt < CACHE_TTL_MS)) {
    return cachedHistory;
  }

  try {
    const rawReleases = await fetchGithubReleases();
    const releases: ReleaseHistoryItem[] = rawReleases.map((r) => {
      const version = (r.tag_name || '').replace(/^v/, '');
      return {
        version,
        name: r.name || `v${version}`,
        publishedAt: r.published_at || '',
        changelog: r.body || '',
        isNewerThanInstalled: compareVersions(version, APP_VERSION) > 0,
      };
    });

    cachedHistory = {
      installed: APP_VERSION,
      releases,
      offline: false,
    };
    cachedAt = now;
    return cachedHistory;
  } catch (err: unknown) {
    console.warn('[UpdateHistory] Unable to fetch GitHub releases (offline or rate-limited):', (err as Error)?.message);
    return {
      installed: APP_VERSION,
      releases: cachedHistory?.releases || [],
      offline: true,
    };
  }
}
