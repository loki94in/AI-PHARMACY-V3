/**
 * Strict Indian phone number sanitization and validation utility.
 * Enforces exactly 10 digits.
 * For mobile numbers (patients / customers / WhatsApp), digits must start with 6, 7, 8, or 9.
 * For distributors / general contacts, digits must be exactly 10 digits.
 */

export interface PhoneValidationResult {
  isValid: boolean;
  cleanPhone: string;
  error?: string;
  reason?: string;
}

export interface PhoneValidationOptions {
  allowEmpty?: boolean;
  allowBlank?: boolean;
  requireMobile?: boolean;
  requireMobilePrefix?: boolean;
}

/**
 * Normalizes phone input by stripping whitespace, symbols, country code prefix (+91 or 91)
 * or leading trunk zero (0), returning the 10-digit normalized string.
 */
export function normalizePhoneDigits(input: any): string {
  if (input === undefined || input === null) return '';
  const raw = String(input).trim();
  if (raw.includes('@') || raw.includes('<')) return '';

  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

/**
 * Validates that an input is a valid 10-digit phone number.
 * @param input Raw phone input string or number
 * @param options.allowEmpty / options.allowBlank If true, empty/undefined/null input is considered valid (returns cleanPhone: '')
 * @param options.requireMobile / options.requireMobilePrefix If true, requires the 10 digits to start with 6, 7, 8, or 9
 */
export function validate10DigitPhone(
  input: any,
  options: PhoneValidationOptions = {}
): PhoneValidationResult {
  const allowEmpty = options.allowEmpty ?? options.allowBlank ?? true;
  const requireMobile = options.requireMobile ?? options.requireMobilePrefix ?? true;

  if (input === undefined || input === null || String(input).trim() === '') {
    if (allowEmpty) {
      return { isValid: true, cleanPhone: '' };
    }
    const msg = 'Phone number is required.';
    return { isValid: false, cleanPhone: '', error: msg, reason: msg };
  }

  const raw = String(input).trim();
  if (raw.includes('@') || raw.includes('<')) {
    const msg = 'Invalid characters in phone number.';
    return { isValid: false, cleanPhone: '', error: msg, reason: msg };
  }

  const digits = normalizePhoneDigits(input);

  if (digits.length !== 10) {
    const msg = `Phone number must be exactly 10 digits (received ${digits.length} digit${digits.length === 1 ? '' : 's'}).`;
    return {
      isValid: false,
      cleanPhone: '',
      error: msg,
      reason: msg
    };
  }

  if (requireMobile && !/^[6-9]\d{9}$/.test(digits)) {
    const msg = 'Mobile phone number must start with 6, 7, 8, or 9.';
    return {
      isValid: false,
      cleanPhone: '',
      error: msg,
      reason: msg
    };
  }

  return { isValid: true, cleanPhone: digits };
}
