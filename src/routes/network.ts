import express from 'express';
import os from 'os';

const router = express.Router();

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  family: string;
  internal: boolean;
}

/**
 * Returns the local LAN IPv4 addresses of the host machine
 */
export function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      // IPv4 and not 127.0.0.1 loopback
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  // Fallback to loopback if no external LAN adapter is active
  if (addresses.length === 0) {
    addresses.push('127.0.0.1');
  }

  return addresses;
}

// GET /api/network/host-info — Returns Host details, LAN IPs, and terminal connection URLs
router.get('/host-info', (_req, res) => {
  try {
    const hostname = os.hostname();
    const ips = getLocalIpAddresses();
    const primaryIp = ips[0] || '127.0.0.1';
    const apiPort = Number(process.env.PORT) || 5174;
    // Client UI typically runs on 5173 in dev or is served through Electron/backend
    const webPort = process.env.NODE_ENV === 'production' ? apiPort : 5173;

    const lanUrls = ips.map(ip => ({
      ip,
      clientUrl: `http://${ip}:${webPort}`,
      apiUrl: `http://${ip}:${apiPort}`,
    }));

    res.json({
      success: true,
      hostname,
      primaryIp,
      availableIps: ips,
      apiPort,
      webPort,
      lanUrls,
      pairingUrl: `http://${primaryIp}:${webPort}`,
      status: 'online',
      system: {
        platform: os.platform(),
        arch: os.arch(),
        uptimeSec: Math.floor(os.uptime()),
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to retrieve network host info: ' + err.message });
  }
});

// GET /api/network/ping — Ultra-lightweight endpoint for client terminals to verify host reachability
router.get('/ping', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

export default router;
