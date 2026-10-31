/**
 * Universal Search & Salutation Normalization Utility
 *
 * Provides title-agnostic, punctuation-resilient multi-token searching
 * across CRM, POS, Orders, and all pages in the app.
 */

const SALUTATION_REGEX = /^(mr|mrs|ms|miss|dr|shri|smt)\.?$/i;

/**
 * Strips known salutation prefix from a name string (e.g. "Mr. Nigde" -> "Nigde").
 */
export function stripSalutation(name?: string | null): string {
  if (!name) return '';
  return name.replace(/^(mr|mrs|miss|ms|dr|shri|smt)\.?\s*[,.-]?\s*/i, '').trim();
}

/**
 * Breaks a search query or target string into normalized lowercase tokens,
 * stripping punctuation and filtering out standalone salutation noise if other tokens exist.
 */
export function extractSearchTokens(input?: string | null): string[] {
  if (!input) return [];
  // Replace punctuation and special characters with spaces
  const cleaned = input.toLowerCase().replace(/[^\w\s]/g, ' ');
  const rawTokens = cleaned.split(/\s+/).filter(Boolean);

  if (rawTokens.length === 0) return [];

  // If there are multiple tokens and one is a salutation (e.g. ['mr', 'nigde']), filter the salutation
  if (rawTokens.length > 1) {
    const nonSalutationTokens = rawTokens.filter(t => !SALUTATION_REGEX.test(t));
    if (nonSalutationTokens.length > 0) {
      return nonSalutationTokens;
    }
  }

  return rawTokens;
}

/**
 * Universal token matcher: checks if all query tokens exist within the target text(s).
 * Title-agnostic, punctuation-insensitive, and order-independent.
 *
 * Examples:
 * - Target: "Mr. Rutuja Nigde", Query: "nigde" -> true
 * - Target: "Mr. Rutuja Nigde", Query: "mr, nigde" -> true
 * - Target: "Rutuja Nigde", Query: "mr nigde" -> true
 * - Target: "Mr. Nigde", Query: "mr. nigde" -> true
 */
export function matchUniversalTokens(
  target: string | (string | undefined | null)[] | undefined | null,
  query: string
): boolean {
  if (!query || !query.trim()) return true;
  if (!target) return false;

  const queryTokens = extractSearchTokens(query);
  if (queryTokens.length === 0) return true;

  const targetArr = Array.isArray(target) ? target : [target];
  const combinedTarget = targetArr
    .filter((t): t is string => Boolean(t))
    .join(' ')
    .toLowerCase();

  // Also include a stripped version of the target to guarantee prefix matches
  const targetTokens = extractSearchTokens(combinedTarget);
  const normalizedTarget = targetTokens.join(' ');

  // Every token in query must match as a substring in the normalized target text
  return queryTokens.every(qToken => normalizedTarget.includes(qToken));
}
