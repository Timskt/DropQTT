/**
 * CSV writing for exports.
 *
 * Topics and payloads in this app are attacker-controllable by definition:
 * anyone who can publish to the broker can name a topic `=cmd|'/c calc'!A1`.
 * Quoting alone does not help -- Excel evaluates a quoted cell that starts with
 * `=`. So any *string* cell whose first character is a formula trigger gets a
 * leading apostrophe, which spreadsheets treat as "this is text".
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return String(value);
  const text = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}
