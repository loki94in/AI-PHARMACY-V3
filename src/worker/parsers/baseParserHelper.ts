import { parseValues } from '../../utils/migrationUtils.js';

/**
 * Extracts and parses the row values from a SQL INSERT statement VALUES (...) clause.
 * Unifies duplicate parsing logic across inventory, returns, and sales migration parsers.
 */
export function extractInsertValues(line: string, uppercaseLine: string, tableName: string): string[] | null {
  const valuesIndex = uppercaseLine.indexOf('VALUES');
  if (valuesIndex === -1) {
    console.warn(`INSERT INTO ${tableName} found but no VALUES clause:`, line);
    return null;
  }

  const afterValues = line.substring(valuesIndex + 6);
  const openParenIndex = afterValues.indexOf('(');
  if (openParenIndex === -1) {
    console.warn(`No opening parenthesis found after VALUES:`, line);
    return null;
  }

  const closeParenIndex = afterValues.indexOf(')', openParenIndex);
  if (closeParenIndex === -1) {
    console.warn(`No closing parenthesis found for VALUES:`, line);
    return null;
  }

  const valuesStr = afterValues.substring(openParenIndex + 1, closeParenIndex).trim();
  return parseValues(valuesStr);
}
