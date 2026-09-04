/**
 * Medicine similarity matcher for Migration & Master Catalog synchronization.
 * Fast in-memory token-indexed matching with strength conflict rejection.
 */

const STOP_WORDS = new Set([
  'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
  'syp', 'syrup', 'susp', 'suspension', 'inj', 'injection', 'oint', 'ointment',
  'crm', 'cream', 'gel', 'drop', 'drops', 'sol', 'solution', 'lot', 'lotion',
  'strip', 'strips', 'box', 'btl', 'bottle', 'vial', 'amp', 'ampoule', 'pack',
  'of', 'for', 'with', 'and', '&', 'gm', 'mg', 'ml', 'mcg', 'iu', 'kg', 'ltr',
  '10s', '15s', '20s', '30s', '5s', '1s', '6s', '10', '15', '20', '30'
]);

export interface MasterMedicineRecord {
  id: number;
  name: string;
  manufacturer?: string | null;
  mrp?: number | null;
}

export interface SimilarityMatchResult {
  id: number;
  name: string;
  manufacturer?: string | null;
  mrp?: number | null;
  score: number;
  reason: string;
}

function normalizeString(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/\[.*?\]/g, ' ') // Strip company brackets like [MICRO LABS]
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(token: string): string {
  return token.replace(/^(\d+)(mg|mcg|ml|gm|g|iu)$/, '$1');
}

function extractTokens(name: string): { coreTokens: string[]; strengths: string[] } {
  const norm = normalizeString(name);
  const words = norm.split(' ').filter(w => w.length > 0);
  const coreTokens: string[] = [];
  const strengths: string[] = [];

  for (const rawWord of words) {
    const word = normalizeToken(rawWord);
    if (/^\d+(\.\d+)?$/.test(word)) {
      strengths.push(word);
      coreTokens.push(word);
    } else if (!STOP_WORDS.has(word) && word.length > 1) {
      coreTokens.push(word);
    }
  }

  return { coreTokens, strengths };
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

export class MedicineSimilarityMatcher {
  private masterList: Array<{
    record: MasterMedicineRecord;
    normName: string;
    coreTokens: Set<string>;
    strengths: Set<string>;
  }> = [];

  private tokenIndex: Map<string, number[]> = new Map();

  constructor(records: MasterMedicineRecord[]) {
    this.buildIndex(records);
  }

  public buildIndex(records: MasterMedicineRecord[]): void {
    this.masterList = [];
    this.tokenIndex.clear();

    records.forEach((rec, idx) => {
      const normName = normalizeString(rec.name);
      const { coreTokens, strengths } = extractTokens(rec.name);
      const tokenSet = new Set(coreTokens);
      const strengthSet = new Set(strengths);

      this.masterList.push({
        record: rec,
        normName,
        coreTokens: tokenSet,
        strengths: strengthSet,
      });

      tokenSet.forEach(token => {
        if (!this.tokenIndex.has(token)) {
          this.tokenIndex.set(token, []);
        }
        this.tokenIndex.get(token)!.push(idx);
      });
    });
  }

  public findBestMatch(importedName: string, minScore = 70): SimilarityMatchResult | null {
    if (!importedName || typeof importedName !== 'string') return null;

    const normImported = normalizeString(importedName);
    const { coreTokens: importedCore, strengths: importedStrengths } = extractTokens(importedName);
    if (importedCore.length === 0) return null;

    const importedSet = new Set(importedCore);
    const candidateIndices = new Set<number>();

    // Fast inverted index lookup: find master medicines that share at least 1 significant token
    for (const token of importedCore) {
      const hits = this.tokenIndex.get(token);
      if (hits) {
        for (const idx of hits) {
          candidateIndices.add(idx);
        }
      }
    }

    if (candidateIndices.size === 0) return null;

    let bestMatch: SimilarityMatchResult | null = null;
    let highestScore = 0;

    for (const idx of candidateIndices) {
      const master = this.masterList[idx];

      // Exact normalized match -> 100%
      if (master.normName === normImported) {
        return {
          id: master.record.id,
          name: master.record.name,
          manufacturer: master.record.manufacturer,
          mrp: master.record.mrp,
          score: 100,
          reason: 'Exact name match',
        };
      }

      // Check strength conflicts: e.g. imported has 500 but master has 650 -> immediate reject
      if (importedStrengths.length > 0 && master.strengths.size > 0) {
        const hasMatchingStrength = importedStrengths.some(s => master.strengths.has(s));
        if (!hasMatchingStrength) {
          continue; // Conflict! Distinct variant (e.g. 500mg vs 650mg)
        }
      }

      // Compute token Jaccard similarity
      let intersection = 0;
      for (const token of importedSet) {
        if (master.coreTokens.has(token)) intersection++;
      }
      const union = new Set([...importedSet, ...master.coreTokens]).size;
      const jaccard = union > 0 ? (intersection / union) : 0;

      // Compute Levenshtein similarity on trimmed core strings
      const maxLen = Math.max(normImported.length, master.normName.length);
      const levDist = levenshteinDistance(normImported, master.normName);
      const levSim = maxLen > 0 ? 1 - (levDist / maxLen) : 0;

      // Weighted score: 60% Token overlap + 40% Levenshtein
      let score = Math.round((jaccard * 0.6 + levSim * 0.4) * 100);

      // Strength bonus: if strength matched explicitly, boost confidence
      if (importedStrengths.length > 0 && master.strengths.size > 0) {
        score = Math.min(100, score + 5);
      }

      if (score > highestScore && score >= minScore) {
        highestScore = score;
        bestMatch = {
          id: master.record.id,
          name: master.record.name,
          manufacturer: master.record.manufacturer,
          mrp: master.record.mrp,
          score,
          reason: `${score}% token & string similarity`,
        };
      }
    }

    return bestMatch;
  }
}
