/**
 * Preload — exposes a safe, typed bridge between renderer and main process.
 * contextIsolation: true prevents the renderer from accessing Node directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
  validateLicense: (licenseId, licenseKey) =>
    ipcRenderer.invoke('validate-license', { licenseId, licenseKey }),

  downloadAndInstall: (downloadUrl, pharmacyName, licenseId, licenseKey) =>
    ipcRenderer.invoke('download-and-install', { downloadUrl, pharmacyName, licenseId, licenseKey }),

  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, pct) => cb(pct)),
  onInstallStatus:    (cb) => ipcRenderer.on('install-status',    (_, msg) => cb(msg)),

  launchApp: () => ipcRenderer.send('launch-app'),
  close:     () => ipcRenderer.send('close-app'),
  minimize:  () => ipcRenderer.send('minimize-app'),
});
