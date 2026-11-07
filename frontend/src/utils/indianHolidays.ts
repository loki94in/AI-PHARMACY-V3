// Indian Public, National & Lunar Festivals Reference
// Single authoritative source of truth for calendar modals, date strips, and notices

export const FIXED_FESTIVALS: Record<string, string> = {
  '01-01': 'New Year',
  '01-14': 'Makar Sankranti',
  '01-26': 'Republic Day',
  '04-14': 'Ambedkar Jayanti',
  '05-01': 'Maharashtra Day',
  '08-15': 'Independence Day',
  '10-02': 'Gandhi Jayanti',
  '12-25': 'Christmas'
};

export const LUNAR_FESTIVALS: string[] = [
  'Diwali',
  'Dhanteras',
  'Bhai Dooj',
  'Holi',
  'Dussehra',
  'Navratri',
  'Ganesh Chaturthi',
  'Raksha Bandhan',
  'Janmashtami',
  'Maha Shivratri',
  'Ram Navami',
  'Eid-ul-Fitr',
  'Eid-ul-Adha',
  'Muharram',
  'Guru Nanak Jayanti',
  'Good Friday'
];

export const INDIAN_HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-26': 'Republic Day',
  '2025-03-14': 'Holi',
  '2025-03-31': 'Id-ul-Fitr',
  '2025-04-18': 'Good Friday',
  '2025-08-15': 'Independence Day',
  '2025-10-02': 'Gandhi Jayanti',
  '2025-10-21': 'Dussehra',
  '2025-10-20': 'Diwali',
  '2025-12-25': 'Christmas',
  // 2026
  '2026-01-01': 'New Year',
  '2026-01-26': 'Republic Day',
  '2026-03-04': 'Mahashivratri',
  '2026-03-14': 'Holi',
  '2026-03-20': 'Id-ul-Fitr',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Ambedkar Jayanti',
  '2026-05-01': 'Maharashtra Day',
  '2026-05-27': 'Bakrid',
  '2026-08-15': 'Independence Day',
  '2026-08-26': 'Janmashtami',
  '2026-09-16': 'Milad-un-Nabi',
  '2026-10-02': 'Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-08': 'Diwali',
  '2026-11-24': 'Guru Nanak Jayanti',
  '2026-12-25': 'Christmas',
  // 2027
  '2027-01-26': 'Republic Day',
  '2027-03-22': 'Holi',
  '2027-08-15': 'Independence Day',
  '2027-10-02': 'Gandhi Jayanti',
  '2027-11-09': 'Diwali',
  '2027-12-25': 'Christmas',
};

export const WEEK_DAYS: string[] = ['None', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Resolves holiday or festival name for a given YYYY-MM-DD date.
 * Priority: Exact date match -> Fixed recurring month-day match -> Occasion mapping.
 */
export function getHolidayName(ymd: string, occasions?: Record<string, string>): string {
  if (occasions && occasions[ymd]) return occasions[ymd];
  if (INDIAN_HOLIDAYS[ymd]) return INDIAN_HOLIDAYS[ymd];
  const mmdd = ymd.slice(5);
  if (FIXED_FESTIVALS[mmdd]) return FIXED_FESTIVALS[mmdd];
  return '';
}

