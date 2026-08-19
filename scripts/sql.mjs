import { readFileSync } from 'node:fs'

/** Split schema.sql into statements. Strips `--` comments first — they can contain `;`. */
export function schemaStatements() {
  return readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}
