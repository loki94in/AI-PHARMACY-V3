#!/usr/bin/env node

/**
 * scripts/start-online-catalog-tunnel.mjs
 * 
 * Zero-Cost Cloudflare Tunnel Launcher for AI Pharmacy:
 * - Creates a secure, encrypted HTTPS tunnel from your local PC to Cloudflare's global edge network.
 * - 100% FREE forever: no monthly fees, no credit card required, unlimited bandwidth.
 * - Auto-detects whether you are running Vite (5173) or Backend/Production (5174/5175).
 * - Pins connections to IPv4 loopback (127.0.0.1) and injects the proper host header to prevent 502 Bad Gateway.
 * 
 * Usage:
 *   node scripts/start-online-catalog-tunnel.mjs
 *   node scripts/start-online-catalog-tunnel.mjs --port=5173
 *   node scripts/start-online-catalog-tunnel.mjs --port=5174
 */

import { spawn } from 'child_process';
import http from 'http';

// Parse command line arguments
const args = process.argv.slice(2);
const portArg = args.find(a => a.startsWith('--port='));
let targetPort = portArg ? parseInt(portArg.split('=')[1], 10) : null;

// Function to check if a local port is open/responding on 127.0.0.1
function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      resolve(true);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolvePort() {
  if (targetPort) return targetPort;
  // Auto-detect priority: Check 5173 (Vite dev frontend) first, then 5174 (Express backend), then 5175 (Packaged)
  const is5173Open = await checkPort(5173);
  if (is5173Open) return 5173;

  const is5174Open = await checkPort(5174);
  if (is5174Open) return 5174;

  const is5175Open = await checkPort(5175);
  if (is5175Open) return 5175;

  return 5173; // default fallback if servers are still booting
}

async function run() {
  const port = await resolvePort();
  const isRunning = await checkPort(port);

  console.log('='.repeat(74));
  console.log('   AI PHARMACY — FREE ZERO-BUDGET CLOUDFLARE TUNNEL LAUNCHER');
  console.log('='.repeat(74));

  if (!isRunning) {
    console.warn(`\n⚠️  NOTICE: No local server detected on port ${port} yet!`);
    console.warn(`   Make sure "npm run dev" is running in another terminal window.`);
    console.warn(`   Waiting for local server on 127.0.0.1:${port} to come online...\n`);
  }

  const localTarget = `http://127.0.0.1:${port}`;
  const hostHeader = `127.0.0.1:${port}`;

  console.log(`Connecting local server (${localTarget}) to Cloudflare Global Edge...`);
  console.log(`Rewriting Host header to "${hostHeader}" (prevents 502 Bad Gateway)...`);
  console.log('Starting Cloudflare Tunnel (100% free, unlimited bandwidth, HTTPS enabled)...\n');

  const isWindows = process.platform === 'win32';
  const child = spawn(
    isWindows ? 'npx.cmd' : 'npx',
    [
      '-y', 'cloudflared', 'tunnel',
      '--url', localTarget,
      '--http-host-header', hostHeader
    ],
    {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: isWindows
    }
  );

  let displayedBanner = false;

  const parseOutput = (data) => {
    const text = data.toString();
    
    // Look for Cloudflare tunnel URL in output
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !displayedBanner) {
      displayedBanner = true;
      const publicUrl = match[0];

      console.log('\n' + '━'.repeat(74));
      console.log('   🎉 YOUR ONLINE PHARMACY CATALOG IS NOW LIVE WORLDWIDE!');
      console.log('━'.repeat(74));
      console.log(`   🌐 Public Home URL:     ${publicUrl}`);
      console.log(`   🛒 Customer Portal:     ${publicUrl}/portal`);
      console.log(`   📦 Online Catalog:      ${publicUrl}/online-catalog`);
      console.log(`   📋 Standalone Web Shop: ${publicUrl}/api/customer-portal/standalone-catalog`);
      console.log('━'.repeat(74));
      console.log('   ✓ Zero cloud fees ($0/month forever)');
      console.log('   ✓ Unlimited bandwidth & global edge caching');
      console.log('   ✓ Fully encrypted SSL/HTTPS connection');
      console.log('   ✓ Press Ctrl+C in this terminal anytime to stop sharing');
      console.log('━'.repeat(74) + '\n');
    }

    // Pass through errors or status logs if not matched
    if (!displayedBanner) {
      process.stderr.write(text);
    }
  };

  child.stdout.on('data', parseOutput);
  child.stderr.on('data', parseOutput);

  child.on('error', (err) => {
    console.error('Failed to start Cloudflare Tunnel:', err.message);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`\nCloudflare tunnel process exited with code ${code}`);
    }
  });

  // Handle process termination gracefully
  const cleanExit = () => {
    if (child && !child.killed) {
      child.kill('SIGINT');
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanExit);
  process.on('SIGTERM', cleanExit);
}

run();
