import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const isKvConfigured = Boolean(url && token);

// Fallback in-memory store for serverless runs if KV is not yet provisioned
const memoryStore = (globalThis.__kvMemoryStore = globalThis.__kvMemoryStore || new Map());

class FallbackStore {
  async get(key) {
    if (!memoryStore.has(key)) return null;
    return JSON.parse(JSON.stringify(memoryStore.get(key)));
  }
  async set(key, value) {
    memoryStore.set(key, JSON.parse(JSON.stringify(value)));
    return 'OK';
  }
  async del(key) {
    return memoryStore.delete(key) ? 1 : 0;
  }
  async keys(pattern) {
    const prefix = pattern.replace('*', '');
    return Array.from(memoryStore.keys()).filter(k => k.startsWith(prefix));
  }
  async mget(...keys) {
    return keys.map(k => memoryStore.get(k) || null);
  }
}

export const kv = isKvConfigured
  ? new Redis({ url, token })
  : new FallbackStore();
