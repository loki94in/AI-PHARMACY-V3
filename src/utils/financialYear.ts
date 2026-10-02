/**
 * Indian Financial Year (FY) utilities.
 * Under Indian accounting and GST rules, the financial year runs from April 1st to March 31st.
 * Invoice numbers from distributors are unique per supplier within a single financial year.
 */

export interface FinancialYearBounds {
  startDate: string; // 'YYYY-04-01'
  endDate: string;   // 'YYYY-03-31'
  fyLabel: string;   // e.g. '2026-27'
  startYear: number; // 2026
  endYear: number;   // 2027
}

/**
 * Calculates the start and end dates and label for the Indian Financial Year corresponding
 * to a given invoice date. If no date is provided or parsing fails, defaults to the current local date.
 */
export function getIndianFinancialYear(dateInput?: string | Date | null): FinancialYearBounds {
  let d: Date;
  if (!dateInput) {
    d = new Date();
  } else if (dateInput instanceof Date) {
    d = isNaN(dateInput.getTime()) ? new Date() : dateInput;
  } else {
    const s = String(dateInput).trim();
    // Match YYYY-MM-DD or YYYY/MM/DD
    const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (m) {
      d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    } else {
      const parsed = new Date(s);
      d = isNaN(parsed.getTime()) ? new Date() : parsed;
    }
  }

  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12

  // April (4) to December (12) belongs to year -> year + 1
  // January (1) to March (3) belongs to year - 1 -> year
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;

  const startYearStr = String(startYear);
  const endYearShort = String(endYear).slice(-2);

  return {
    startDate: `${startYear}-04-01`,
    endDate: `${endYear}-03-31`,
    fyLabel: `${startYearStr}-${endYearShort}`,
    startYear,
    endYear,
  };
}
