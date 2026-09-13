import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const isKvConfigured = Boolean(url && token);

export const kv = isKvConfigured
  ? new Redis({ url, token })
  : new Redis({
      url: 'https://placeholder.upstash.io',
      token: 'placeholder_token',
    });
