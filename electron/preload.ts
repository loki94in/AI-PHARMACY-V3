/**
 * Electron preload script.
 * Runs in the renderer process (the BrowserWindow) with Node integration OFF.
 * contextIsolation: true — nothing from Node is exposed to the web page.
 * This is intentionally minimal: the app talks to its own local Express backend
 * via standard HTTP/SSE, so no IPC bridge is needed.
 */
// ponytail: no IPC bridge needed — app uses HTTP to talk to local Express backend
