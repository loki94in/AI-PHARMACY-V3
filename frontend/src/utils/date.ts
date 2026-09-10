/**
 * Returns a date string formatted as YYYY-MM-DD in the local timezone.
 */
export const getLocalDateString = (d: Date = new Date()): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Returns today's date string formatted as YYYY-MM-DD in the local timezone.
 */
export const getTodayString = (): string => {
  return getLocalDateString(new Date());
};

/**
 * Returns a date string for N days ago formatted as YYYY-MM-DD in the local timezone.
 */
export const getNDaysAgoString = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return getLocalDateString(d);
};

/**
 * Coerces any date/datetime value (including SQLite "YYYY-MM-DD HH:mm:ss.SSS" timestamps)
 * into the strict YYYY-MM-DD format required by <input type="date">'s value attribute.
 * Returns '' for empty/invalid input so the browser doesn't reject an unparseable value.
 */
export const toDateInputValue = (dateVal: string | number | Date | null | undefined): string => {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  }
  const d = parseLocalDate(dateVal);
  return d ? getLocalDateString(d) : '';
};

/**
 * Safely parses any date string, timestamp, or Date object directly into PC local time (IST).
 * Guarantees zero UTC timezone shift for ISO YYYY-MM-DD or YYYY-MM-DD HH:mm:ss strings.
 */
export const parseLocalDate = (dateVal: string | number | Date | null | undefined): Date | null => {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return isNaN(dateVal.getTime()) ? null : dateVal;

  if (typeof dateVal === 'number') {
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(dateVal).trim();
  if (!str) return null;

  // If the string contains an explicit UTC marker (Z) or timezone offset (+HH:MM / -HH:MM),
  // let standard JS Date handle it so it correctly converts UTC ISO timestamps to local PC time (e.g. IST).
  if (/Z$|[+-]\d{2}:?\d{2}$/i.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // Parse YYYY-MM-DD or YYYY-MM-DD HH:mm:ss explicitly into local PC time (avoids UTC 00:00 -> 05:30 AM IST shift for date-only strings)
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const hours = isoMatch[4] ? parseInt(isoMatch[4], 10) : 0;
    const minutes = isoMatch[5] ? parseInt(isoMatch[5], 10) : 0;
    const seconds = isoMatch[6] ? parseInt(isoMatch[6], 10) : 0;

    const localDate = new Date(year, month, day, hours, minutes, seconds);
    return isNaN(localDate.getTime()) ? null : localDate;
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Formats any date string, timestamp, or Date object into DD/MM/YYYY format using PC local time.
 * If includeTime is true and time exists, appends time formatted as hh:mm AM/PM.
 */
export const formatDisplayDate = (
  dateVal: string | number | Date | null | undefined,
  includeTime = false
): string => {
  if (!dateVal) return '';
  const d = parseLocalDate(dateVal);
  if (!d) return String(dateVal);

  const pad = (num: number) => String(num).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();

  const str = String(dateVal).trim();
  const hasTime = str.includes(':') || (dateVal instanceof Date && (d.getHours() > 0 || d.getMinutes() > 0 || d.getSeconds() > 0));

  if (!includeTime || !hasTime) {
    return `${day}/${month}/${year}`;
  }

  let hours = d.getHours();
  const minutes = pad(d.getMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 hour should be 12
  const formattedHours = pad(hours);

  return `${day}/${month}/${year} ${formattedHours}:${minutes} ${ampm}`;
};

/**
 * Sanitizes and formats an expiry date string to MM/YY format.
 * Guarantees month is strictly clamped between 01 and 12, and year is formatted as 2 digits.
 */
export const sanitizeMonth = (mStr: string): string => {
  let m = parseInt(mStr, 10);
  if (isNaN(m) || m < 1) m = 1;
  if (m > 12) m = 12;
  return m < 10 ? `0${m}` : `${m}`;
};

export const formatExpiryToMMYY = (val: string): string => {
  if (!val) return '';
  const cleaned = val.trim().replace(/\s+/g, '');
  if (cleaned === '00000000' || cleaned === '00/00' || cleaned === '*' || cleaned === '***' || cleaned === '//*' || cleaned === '-') return '';

  // 1. Handle ISO YYYY-MM-DD or YYYY-MM or YYYY/MM/DD or YYYY/MM
  const isoMatch = cleaned.match(/^(\d{4})[\/\-](\d{1,2})(?:[\/\-](\d{1,2}))?/);
  if (isoMatch) {
    const mm = sanitizeMonth(isoMatch[2]);
    const yy = isoMatch[1].substring(2, 4);
    return `${mm}/${yy}`;
  }

  // 2. Handle month names, e.g. Dec-26, Dec-2026, 31-Dec-2026, Dec/26, Dec 2026
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const monthNameMatch = cleaned.match(/(?:(\d{1,2})[\/\-\s]+)?([a-z]{3,9})[\/\-\s]+(\d{2,4})/i);
  if (monthNameMatch) {
    const mStr = monthNameMatch[2].substring(0, 3).toLowerCase();
    const mm = monthMap[mStr];
    let yy = monthNameMatch[3];
    if (mm) {
      if (yy.length === 4) yy = yy.substring(2, 4);
      return `${mm}/${yy}`;
    }
  }

  // 3. Handle 3-part dates: DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY, DD-MM-YY
  const threeParts = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (threeParts) {
    const p1 = parseInt(threeParts[1], 10);
    const p2 = parseInt(threeParts[2], 10);
    let yy = threeParts[3];
    if (yy.length === 4) yy = yy.substring(2, 4);

    let mm = '';
    if (p1 > 12 && p2 >= 1 && p2 <= 12) {
      mm = sanitizeMonth(threeParts[2]);
    } else if (p2 > 12 && p1 >= 1 && p1 <= 12) {
      mm = sanitizeMonth(threeParts[1]);
    } else if (p2 >= 1 && p2 <= 12) {
      mm = sanitizeMonth(threeParts[2]);
    } else if (p1 >= 1 && p1 <= 12) {
      mm = sanitizeMonth(threeParts[1]);
    }
    if (mm && yy) return `${mm}/${yy}`;
  }

  // 4. Handle MM/YYYY or MM-YYYY
  const mmYyyy = cleaned.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (mmYyyy) {
    const mm = sanitizeMonth(mmYyyy[1]);
    const yy = mmYyyy[2].substring(2, 4);
    return `${mm}/${yy}`;
  }

  // 5. Handle MM/YY or MM-YY
  const mmYy = cleaned.match(/^(\d{1,2})[\/\-](\d{2})$/);
  if (mmYy) {
    const mm = sanitizeMonth(mmYy[1]);
    const yy = mmYy[2];
    return `${mm}/${yy}`;
  }

  // 6. 8 digits: DDMMYYYY or YYYYMMDD
  if (/^\d{8}$/.test(cleaned)) {
    if (cleaned.startsWith('20')) {
      const mm = sanitizeMonth(cleaned.substring(4, 6));
      const yy = cleaned.substring(2, 4);
      return `${mm}/${yy}`;
    }
    const mm = sanitizeMonth(cleaned.substring(2, 4));
    const yy = cleaned.substring(6, 8);
    return `${mm}/${yy}`;
  }

  // 7. 6 digits: MMYYYY
  if (/^\d{6}$/.test(cleaned)) {
    if (cleaned.endsWith('2025') || cleanEndYear(cleaned)) {
      const mm = sanitizeMonth(cleaned.substring(0, 2));
      const yy = cleaned.substring(4, 6);
      return `${mm}/${yy}`;
    }
    const mm = sanitizeMonth(cleaned.substring(0, 2));
    const yy = cleaned.substring(4, 6);
    return `${mm}/${yy}`;
  }

  // 8. 4 digits: MMYY
  if (/^\d{4}$/.test(cleaned)) {
    const mm = sanitizeMonth(cleaned.substring(0, 2));
    const yy = cleaned.substring(2, 4);
    return `${mm}/${yy}`;
  }

  return cleaned;
};

function cleanEndYear(c: string): boolean {
  return /20[2-3]\d$/.test(c);
}

/**
 * Checks whether an expiry date string is expired relative to current month/year.
 * Returns true if the expiry date is in the past.
 */
export const isExpiredDate = (expiry_date?: string | null): boolean => {
  if (!expiry_date) return false;
  const trimmed = String(expiry_date).trim();
  if (!trimmed) return false;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  let expYear;
  let expMonth;

  if (/^\d{1,2}\/\d{2}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    expMonth = parseInt(parts[0], 10);
    expYear = 2000 + parseInt(parts[1], 10);
  } else if (/^\d{1,2}\/\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    expMonth = parseInt(parts[0], 10);
    expYear = parseInt(parts[1], 10);
  } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('-');
    expMonth = parseInt(parts[1], 10);
    expYear = parseInt(parts[2], 10);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    expMonth = parseInt(parts[1], 10);
    expYear = parseInt(parts[2], 10);
  } else if (/^\d{4}-\d{2}/.test(trimmed)) {
    const parts = trimmed.split('-');
    expYear = parseInt(parts[0], 10);
    expMonth = parseInt(parts[1], 10);
  } else {
    return false;
  }

  if (isNaN(expYear) || isNaN(expMonth)) return false;

  if (expYear < currentYear) return true;
  if (expYear === currentYear && expMonth < currentMonth) return true;
  return false;
};

