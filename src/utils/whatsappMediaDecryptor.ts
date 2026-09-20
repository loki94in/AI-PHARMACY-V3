import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

export interface DecryptMediaOptions {
  directPath?: string;
  mediaKey?: string | Buffer | Uint8Array;
  mimetype?: string;
  type?: string;
  encFilehash?: string;
  filehash?: string;
  preview?: string;
}

export interface DecryptedMediaResult {
  data: string; // base64 string
  buffer: Buffer;
  mimetype: string;
  source: 'cdn_direct' | 'browser_blob' | 'preview_thumbnail';
}

const MEDIA_HKDF_INFO_MAP: Record<string, string> = {
  image: 'WhatsApp Image Keys',
  document: 'WhatsApp Document Keys',
  audio: 'WhatsApp Audio Keys',
  ptt: 'WhatsApp Audio Keys',
  video: 'WhatsApp Video Keys',
  sticker: 'WhatsApp Image Keys',
};

const CDN_HOSTS = [
  'https://mmg.whatsapp.net',
  'https://mmg-fna.whatsapp.net',
  'https://crashlogs.whatsapp.net',
];

/**
 * Expand 32-byte mediaKey into 112 bytes using HKDF-SHA256 according to WhatsApp protocol:
 * - IV: first 16 bytes
 * - CipherKey: next 32 bytes (16..48)
 * - MacKey: next 32 bytes (48..80)
 */
export function deriveMediaKeys(
  mediaKey: string | Buffer | Uint8Array,
  mediaType: string = 'image'
): { iv: Buffer; cipherKey: Buffer; macKey: Buffer } {
  const keyBuffer = Buffer.isBuffer(mediaKey)
    ? mediaKey
    : typeof mediaKey === 'string'
    ? Buffer.from(mediaKey, 'base64')
    : Buffer.from(mediaKey);

  if (keyBuffer.length !== 32) {
    throw new Error(`Invalid mediaKey length: ${keyBuffer.length} bytes (expected 32)`);
  }

  const infoStr = MEDIA_HKDF_INFO_MAP[mediaType.toLowerCase()] || 'WhatsApp Image Keys';
  const salt = Buffer.alloc(32); // WhatsApp uses empty 32-zero salt for media HKDF

  // ponytail: built-in crypto.hkdfSync avoids extra npm dependencies
  const expanded = crypto.hkdfSync('sha256', keyBuffer, salt, Buffer.from(infoStr), 112);
  const expandedBuf = Buffer.from(expanded);

  return {
    iv: expandedBuf.subarray(0, 16),
    cipherKey: expandedBuf.subarray(16, 48),
    macKey: expandedBuf.subarray(48, 80),
  };
}

/**
 * Decrypt raw ciphertext buffer from WhatsApp CDN:
 * WhatsApp appends a 10-byte truncated HMAC-SHA256 MAC to the ciphertext,
 * so the encrypted file data is ciphertext[0 .. length - 10].
 */
export function decryptCiphertext(
  encBuffer: Buffer,
  cipherKey: Buffer,
  iv: Buffer
): Buffer {
  if (encBuffer.length <= 10) {
    throw new Error(`Ciphertext buffer too small: ${encBuffer.length} bytes`);
  }

  // Strip trailing 10-byte MAC
  const ciphertext = encBuffer.subarray(0, encBuffer.length - 10);

  const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Fetch and decrypt media directly from WhatsApp CDN in pure Node.js.
 * Completely independent of Puppeteer and WhatsApp Web internal modules.
 */
export async function downloadAndDecryptCdnMedia(
  options: DecryptMediaOptions,
  timeoutMs: number = 15000
): Promise<DecryptedMediaResult | null> {
  const { directPath, mediaKey, mimetype = 'image/jpeg', type = 'image' } = options;

  if (!directPath || !mediaKey) {
    return null;
  }

  const { iv, cipherKey } = deriveMediaKeys(mediaKey, type);

  const urlsToTry: string[] = [];
  if (directPath.startsWith('http://') || directPath.startsWith('https://')) {
    urlsToTry.push(directPath);
  } else {
    const cleanPath = directPath.startsWith('/') ? directPath : `/${directPath}`;
    for (const host of CDN_HOSTS) {
      urlsToTry.push(`${host}${cleanPath}`);
    }
  }

  let lastError: any = null;
  for (const url of urlsToTry) {
    try {
      const resp = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://web.whatsapp.com',
          'Referer': 'https://web.whatsapp.com/',
        },
      });

      if (resp.status === 200 && resp.data) {
        const encBuffer = Buffer.from(resp.data);
        const decrypted = decryptCiphertext(encBuffer, cipherKey, iv);

        if (decrypted.length > 0) {
          return {
            buffer: decrypted,
            data: decrypted.toString('base64'),
            mimetype,
            source: 'cdn_direct',
          };
        }
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  if (lastError) {
    console.warn('[Media Decryptor] CDN download attempts failed:', lastError?.message || lastError);
  }
  return null;
}

/**
 * High-reliability media extractor for WhatsApp messages.
 * 1. Tries direct CDN download & AES-256-CBC decryption (100% pure Node.js)
 * 2. Falls back to embedded preview/thumbnail if present
 */
export async function extractWhatsAppMedia(
  options: DecryptMediaOptions,
  timeoutMs: number = 15000
): Promise<DecryptedMediaResult | null> {
  // Step 1: Direct CDN decryption
  try {
    const cdnResult = await downloadAndDecryptCdnMedia(options, timeoutMs);
    if (cdnResult) {
      return cdnResult;
    }
  } catch (cdnErr: any) {
    console.warn('[Media Decryptor] Direct CDN decrypt failed, falling back:', cdnErr?.message || cdnErr);
  }

  // Step 2: Embedded preview / thumbnail fallback
  if (options.preview && typeof options.preview === 'string' && options.preview.length > 50) {
    try {
      const cleanBase64 = options.preview.replace(/^data:image\/[a-z]+;base64,/, '');
      const buf = Buffer.from(cleanBase64, 'base64');
      if (buf.length > 0) {
        console.log('[Media Decryptor] Using embedded preview thumbnail as resilient media fallback.');
        return {
          buffer: buf,
          data: cleanBase64,
          mimetype: options.mimetype || 'image/jpeg',
          source: 'preview_thumbnail',
        };
      }
    } catch (_) {}
  }

  return null;
}
