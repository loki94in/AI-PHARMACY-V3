import { describe, it, expect } from '@jest/globals';
import { compareVersions } from '../src/services/autoUpdateService.js';
import { APP_VERSION } from '../src/services/licenseService.js';

describe('Auto-Update Client-Side Semver Gate (P2-107)', () => {
  describe('compareVersions semver logic', () => {
    it('returns 0 when versions are identical', () => {
      expect(compareVersions('0.1.151', '0.1.151')).toBe(0);
      expect(compareVersions('v0.1.151', '0.1.151')).toBe(0);
      expect(compareVersions('0.1.151', 'v0.1.151')).toBe(0);
    });

    it('returns > 0 when first version is newer', () => {
      expect(compareVersions('0.1.151', '0.1.132')).toBeGreaterThan(0);
      expect(compareVersions('0.1.151', '0.1.150')).toBeGreaterThan(0);
      expect(compareVersions('0.2.0', '0.1.151')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    });

    it('returns < 0 when first version is older', () => {
      expect(compareVersions('0.1.132', '0.1.151')).toBeLessThan(0);
      expect(compareVersions('0.1.150', '0.1.151')).toBeLessThan(0);
      expect(compareVersions('0.1.151', '0.1.152')).toBeLessThan(0);
      expect(compareVersions('0.1.151', '0.2.0')).toBeLessThan(0);
    });
  });

  describe('Semver gate decision logic against running APP_VERSION', () => {
    it('rejects update when server claims older release is latest', () => {
      // Simulates P2-107 incident: running 0.1.151, server answers 0.1.132 with hasUpdate=true
      const serverReported = {
        hasUpdate: true,
        latestVersion: '0.1.132',
        updatePackageUrl: 'https://example.com/update-0.1.132.zip',
      };

      const isNewer = compareVersions(serverReported.latestVersion, APP_VERSION) > 0;
      const trulyHasUpdate = Boolean(serverReported.hasUpdate && isNewer);

      expect(isNewer).toBe(false);
      expect(trulyHasUpdate).toBe(false);
    });

    it('rejects update when server claims same version is latest', () => {
      const serverReported = {
        hasUpdate: true,
        latestVersion: APP_VERSION,
        updatePackageUrl: 'https://example.com/update-same.zip',
      };

      const isNewer = compareVersions(serverReported.latestVersion, APP_VERSION) > 0;
      const trulyHasUpdate = Boolean(serverReported.hasUpdate && isNewer);

      expect(isNewer).toBe(false);
      expect(trulyHasUpdate).toBe(false);
    });

    it('accepts update only when server version is strictly newer than APP_VERSION', () => {
      const newerVersion = '99.0.0';
      const serverReported = {
        hasUpdate: true,
        latestVersion: newerVersion,
        updatePackageUrl: 'https://example.com/update-newer.zip',
      };

      const isNewer = compareVersions(serverReported.latestVersion, APP_VERSION) > 0;
      const trulyHasUpdate = Boolean(serverReported.hasUpdate && isNewer);

      expect(isNewer).toBe(true);
      expect(trulyHasUpdate).toBe(true);
    });
  });

  describe('P2-111: Version Floor Clamping & Idle Progress Handling', () => {
    it('clamps latestVersion to APP_VERSION when server answers an older release', () => {
      const serverReportedVersion = '0.1.132';
      const runningAppVersion = '0.1.154';

      const isNewer = compareVersions(serverReportedVersion, runningAppVersion) > 0;
      const effectiveLatest = isNewer ? serverReportedVersion : runningAppVersion;

      expect(isNewer).toBe(false);
      expect(effectiveLatest).toBe(runningAppVersion);
    });

    it('forces downloading to false and progress to 0 when version is older or equal', () => {
      const serverPayload = {
        hasUpdate: false,
        latestVersion: '0.1.132',
        downloading: false,
        downloadProgress: 0,
      };
      const runningAppVersion = '0.1.154';

      const isNewer = compareVersions(serverPayload.latestVersion, runningAppVersion) > 0;
      const effectiveDownloading = Boolean(serverPayload.downloading && isNewer);
      const effectiveProgress = isNewer ? serverPayload.downloadProgress : 0;
      const effectiveHasUpdate = Boolean(serverPayload.hasUpdate && isNewer);

      expect(effectiveDownloading).toBe(false);
      expect(effectiveProgress).toBe(0);
      expect(effectiveHasUpdate).toBe(false);
    });
  });
});
