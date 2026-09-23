/**
 * Shared Dosage Group Classification Service
 * 
 * Normalizes medicine dosage forms into high-level groups:
 * - TAB: Solid oral formulations (Tablet, Capsule, Softgel, Caplet, etc.)
 * - BOTTLE: Liquid oral formulations (Syrup, Suspension, Tonic, Elixir, Drops, etc.)
 * - ALL: Universal fallback (Injections, Creams, Inhalers, or unclassified)
 */

export type DosageGroup = 'TAB' | 'BOTTLE' | 'ALL';

export const SOLID_ORAL_FORMS = [
  'tablet',
  'tab',
  'capsule',
  'cap',
  'soft gel',
  'softgel',
  'dt',
  'caplet',
  'chewable tablet',
  'pellets',
  'pills',
  'strip'
] as const;

export const LIQUID_ORAL_FORMS = [
  'syrup',
  'syp',
  'suspension',
  'susp',
  'liquid',
  'elixir',
  'tonic',
  'kadha',
  'kwath',
  'oral drops',
  'drops',
  'solution',
  'emulsion',
  'bottle'
] as const;

/**
 * Classify a raw dosage form string into TAB, BOTTLE, or ALL.
 */
export function classifyDosageGroup(dosageForm?: string | null): DosageGroup {
  if (!dosageForm || typeof dosageForm !== 'string') return 'ALL';
  const clean = dosageForm.trim().toLowerCase();
  
  for (const form of SOLID_ORAL_FORMS) {
    if (clean === form || clean.includes(form)) {
      return 'TAB';
    }
  }

  for (const form of LIQUID_ORAL_FORMS) {
    if (clean === form || clean.includes(form)) {
      return 'BOTTLE';
    }
  }

  return 'ALL';
}

/**
 * Check if a medicine's dosage form matches the requested DosageGroup.
 */
export function matchesDosageGroup(dosageForm: string | undefined | null, group: DosageGroup): boolean {
  if (group === 'ALL') return true;
  return classifyDosageGroup(dosageForm) === group;
}

/**
 * Returns an array of canonical form keywords for the specified group.
 */
export function getFormsForGroup(group: DosageGroup): readonly string[] {
  if (group === 'TAB') return SOLID_ORAL_FORMS;
  if (group === 'BOTTLE') return LIQUID_ORAL_FORMS;
  return [];
}

/**
 * Generate an SQL WHERE clause fragment to filter medicines or catalog items by dosage group.
 */
export function getGroupSqlFilter(group: DosageGroup, columnName: string = 'dosage_form'): { sql: string; params: string[] } {
  if (group === 'ALL') {
    return { sql: '1=1', params: [] };
  }

  const forms = group === 'TAB' ? SOLID_ORAL_FORMS : LIQUID_ORAL_FORMS;
  const conditions = forms.map(() => `LOWER(${columnName}) LIKE ?`).join(' OR ');
  const params = forms.map(f => `%${f}%`);

  return {
    sql: `(${conditions})`,
    params
  };
}
