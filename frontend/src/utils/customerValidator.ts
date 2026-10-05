/**
 * Customer and Doctor Name Validation Utilities.
 * Rejects empty strings, placeholders, and dummy default values.
 */

const PLACEHOLDER_CUSTOMER_NAMES = [
  'walk-in customer',
  'walk in customer',
  'walk-in',
  'walk in',
  'walk-in patient',
  'walk in patient',
  'walkin',
  'unnamed customer',
  'unnamed patient',
  'unnamed',
  'customer',
  'patient',
  'self',
  'unknown customer',
  'unknown patient',
  'unknown',
  'default customer',
  'default',
  'n/a',
  'na',
  'none',
  'null',
  '-',
  '.'
];

export function isValidCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (!trimmed || trimmed.length < 2) return false;

  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_CUSTOMER_NAMES.includes(lower)) {
    return false;
  }

  // Reject pure numeric strings
  if (/^\d+$/.test(trimmed)) {
    return false;
  }

  return true;
}

const PLACEHOLDER_DOCTOR_NAMES = [
  'self',
  'doctor',
  'dr',
  'dr.',
  'dr .',
  'doctor .',
  'unknown doctor',
  'unknown doc',
  'unknown',
  'general doctor',
  'general',
  'default doctor',
  'default',
  'n/a',
  'na',
  'none',
  'null',
  '-',
  '.'
];

export function isValidDoctorName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (!trimmed || trimmed.length < 2) return false;

  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_DOCTOR_NAMES.includes(lower)) {
    return false;
  }

  // Reject pure numeric strings
  if (/^\d+$/.test(trimmed)) {
    return false;
  }

  return true;
}
