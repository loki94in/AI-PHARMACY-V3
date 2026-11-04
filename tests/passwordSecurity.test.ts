import crypto from 'crypto';
import { hashPassword, verifyPassword } from '../src/utils/password.js';
import { verifyManifestAuthenticity } from '../src/services/localAi/manifestSchema.js';

describe('Password & Hex String Security and Sanitization Tests', () => {
  it('should successfully hash and verify standard passwords', () => {
    const rawPass = 'PharmacyAdmin2026!';
    const hashed = hashPassword(rawPass);

    expect(hashed.startsWith('pbkdf2:100000:')).toBe(true);
    expect(verifyPassword(rawPass, hashed)).toBe(true);
    expect(verifyPassword('WrongPass', hashed)).toBe(false);
  });

  it('should verify password without hex warnings even if stored hash contains trailing spaces or newlines', () => {
    const rawPass = 'SecretShopPass#1';
    const cleanHash = hashPassword(rawPass);

    // Simulate accidental whitespace and newlines stored in SQLite or .env
    const dirtyHashWithSpaces = `${cleanHash}   \r\n`;

    const warnings: string[] = [];
    const originalEmitWarning = process.emitWarning;
    process.emitWarning = (warning: any, ...args: any[]) => {
      const msg = typeof warning === 'string' ? warning : warning?.message || '';
      warnings.push(msg);
      return originalEmitWarning.apply(process, [warning, ...args] as any);
    };

    try {
      const isMatch = verifyPassword(rawPass, dirtyHashWithSpaces);
      expect(isMatch).toBe(true);

      // Verify no "invalid character" hex warning occurred
      const hexWarnings = warnings.filter((w) => w.includes('hex string') || w.includes('invalid character'));
      expect(hexWarnings.length).toBe(0);
    } finally {
      process.emitWarning = originalEmitWarning;
    }
  });

  it('should verify password when salt or hash have internal whitespace artifacts', () => {
    const rawPass = 'CashierDesk#9';
    const cleanHash = hashPassword(rawPass);
    const parts = cleanHash.split(':');
    // Inject spaces into parts[3] (the hex hash)
    const spacedHash = `${parts[0]}:${parts[1]}:${parts[2]}: ${parts[3]}  `;

    expect(verifyPassword(rawPass, spacedHash)).toBe(true);
  });

  it('should reject malformed or empty inputs gracefully without throwing', () => {
    expect(verifyPassword('', 'pbkdf2:100000:salt:hash')).toBe(false);
    expect(verifyPassword('pass', '')).toBe(false);
    expect(verifyPassword('pass', 'pbkdf2:invalid:salt:hash')).toBe(false);
  });

  it('should sanitize signatures with whitespace in manifest schema verification', () => {
    const fakeManifest = JSON.stringify({ version: '1.0.0', model: 'test' });
    const secret = 'release-signing-key-12345';
    const validHmac = crypto.createHmac('sha256', secret).update(fakeManifest).digest('hex');

    // Signature with whitespace and newlines
    const signatureWithSpaces = `  ${validHmac} \n`;
    const isValid = verifyManifestAuthenticity(fakeManifest, signatureWithSpaces, secret);
    expect(isValid).toBe(true);
  });
});
