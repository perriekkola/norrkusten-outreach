import { readFileSync } from 'node:fs'

/**
 * Split schema.sql into statements.
 *
 * Comments are stripped first, including trailing ones — a `--` comment can contain a
 * semicolon, which would otherwise cut a statement in half. Assumes no `--` appears
 * inside a string literal, which holds for this schema.
 */
export function schemaStatements() {
  return readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--')
      return comment === -1 ? line : line.slice(0, comment)
    })
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}
