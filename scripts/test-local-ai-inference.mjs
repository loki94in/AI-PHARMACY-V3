#!/usr/bin/env node
/**
 * Real Local AI Inference Benchmark & Smoke Test
 * Tests live llama-server.exe with Qwen3-1.7B Q4_K_M on CPU (-ngl 0).
 * Measures startup time, inference latency, process memory (RSS), and structured JSON validation.
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const rootDir = process.cwd();
const modelsDir = path.resolve(rootDir, 'models', 'local-ai');
const runtimeExe = path.join(modelsDir, 'llama-server.exe');
const modelFile = path.join(modelsDir, 'qwen3-1.7b-q4_k_m.gguf');

console.log('\n=============================================================');
console.log(' Live Local AI Inference & Resource Benchmark');
console.log(' Runtime:', runtimeExe);
console.log(' Model:', modelFile);
console.log(' Hardware Target: 8 GB RAM / No-GPU CPU Execution');
console.log('=============================================================\n');

if (!fs.existsSync(runtimeExe) || !fs.existsSync(modelFile)) {
  console.error('❌ Required assets missing from', modelsDir);
  process.exit(1);
}

const host = '127.0.0.1';
const port = 8089; // Dedicated benchmark port to avoid collision
const cpuThreads = Math.max(1, Math.min(4, os.cpus().length - 1));

console.log(`System Profile:`);
console.log(`  OS: ${os.type()} ${os.release()} (${os.arch()})`);
console.log(`  Total RAM: ${(os.totalmem() / (1024 ** 3)).toFixed(2)} GB`);
console.log(`  Free RAM: ${(os.freemem() / (1024 ** 3)).toFixed(2)} GB`);
console.log(`  CPU: ${os.cpus()[0]?.model} (${os.cpus().length} logical cores)`);
console.log(`  Threads assigned: ${cpuThreads}`);

let serverProcess = null;

function getProcessMemoryMb(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64 / 1MB"`, { encoding: 'utf8' });
      return parseFloat(out.trim());
    }
  } catch (_) {}
  return 0;
}

async function pingHealth() {
  try {
    const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function runBenchmark() {
  const startupStart = performance.now();
  console.log(`\nStep 1: Spawning llama-server.exe with -ngl 0, -c 2048, -t ${cpuThreads}...`);

  serverProcess = spawn(runtimeExe, [
    '-m', modelFile,
    '--host', host,
    '--port', String(port),
    '-ngl', '0',
    '-t', String(cpuThreads),
    '-c', '2048',
    '--log-disable'
  ], {
    cwd: modelsDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  serverProcess.on('error', (err) => {
    console.error('Process error:', err);
  });

  // Wait for health
  let healthy = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 300));
    if (await pingHealth()) {
      healthy = true;
      break;
    }
  }

  const startupMs = Math.round(performance.now() - startupStart);
  if (!healthy) {
    console.error(`❌ llama-server failed to become healthy within ${startupMs} ms.`);
    killServer();
    process.exit(1);
  }

  console.log(`✓ llama-server ready in ${startupMs} ms (${(startupMs / 1000).toFixed(2)} s)`);
  const initialMemMb = getProcessMemoryMb(serverProcess.pid);
  console.log(`  Initial Process Working Set: ${initialMemMb.toFixed(1)} MB`);

  // Step 2: Test Inference with real pharmacy inputs
  console.log('\nStep 2: Executing Real Inference Test Queries...');

  const testPrompts = [
    { label: 'Hinglish Medicine Order', text: 'bhai paracetamol 650mg 2 strip bhej do please' },
    { label: 'English Medicine Order', text: 'Need 1 box of Amoxicillin 500mg urgently' },
    { label: 'Refill Inquiry', text: 'kal subah tak BP ki regular dawai bhej doge?' },
    { label: 'Shop Timings (Non-Order)', text: 'bhaiya shop kab tak open rehti hai?' },
    { label: 'Grounded Q&A (Availability & Price)', text: 'Is Dolo 650 available and what is the price?' }
  ];

  const systemPrompt = `You are a medical pharmacy intent classification engine.
Given customer messages, classify their intent into exactly one of: ORDER, REFILL, INQUIRY, CHITCHAT, or UNKNOWN.
Extract any requested medicines with name, quantity, and unit.
Respond ONLY with a valid JSON object matching this schema:
{
  "intent": "ORDER" | "REFILL" | "INQUIRY" | "CHITCHAT" | "UNKNOWN",
  "confidence": 0.0 to 1.0,
  "medicines": [
    {
      "name": "Medicine Name",
      "quantity": 1 to 100,
      "unit": "strip" | "tablet" | "box" | "bottle"
    }
  ],
  "explanation": "Brief explanation"
}`;

  let totalLatency = 0;
  let peakMemMb = initialMemMb;

  for (const { label, text } of testPrompts) {
    const qStart = performance.now();
    const payload = {
      model: 'qwen3-1.7b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
      max_tokens: 160,
      response_format: { type: 'json_object' }
    };

    const res = await fetch(`http://${host}:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const latencyMs = Math.round(performance.now() - qStart);
    totalLatency += latencyMs;

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '{}';

    const currentMemMb = getProcessMemoryMb(serverProcess.pid);
    if (currentMemMb > peakMemMb) peakMemMb = currentMemMb;

    console.log(`\n  Query: "${text}" [${label}]`);
    console.log(`  Latency: ${latencyMs} ms | Process RAM: ${currentMemMb.toFixed(1)} MB`);
    try {
      const parsed = JSON.parse(content);
      console.log(`  Output: intent=${parsed.intent}, conf=${parsed.confidence}, meds=${JSON.stringify(parsed.medicines || [])}`);
    } catch {
      console.log(`  Raw output: ${content.trim()}`);
    }
  }

  const avgLatency = Math.round(totalLatency / testPrompts.length);
  console.log('\n=============================================================');
  console.log(' Benchmark Summary');
  console.log(`  Startup Time: ${startupMs} ms`);
  console.log(`  Average Inference Latency: ${avgLatency} ms`);
  console.log(`  Peak Process Working Set: ${peakMemMb.toFixed(1)} MB (~${(peakMemMb / 1024).toFixed(2)} GB)`);
  console.log(`  8 GB RAM Budget Impact: ${((peakMemMb / 8192) * 100).toFixed(1)}% of 8 GB`);
  console.log('=============================================================\n');

  killServer();
}

function killServer() {
  if (serverProcess && serverProcess.pid) {
    console.log('Stopping test llama-server process...');
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${serverProcess.pid} /t /f`, { stdio: 'ignore' });
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch (_) {}
    serverProcess = null;
  }
}

process.on('SIGINT', () => { killServer(); process.exit(0); });
process.on('SIGTERM', () => { killServer(); process.exit(0); });

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  killServer();
  process.exit(1);
});

