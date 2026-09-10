import { readFileSync } from 'node:fs'

/**
 * Split schema.sql into statements.
 *
 * Comments are stripped first, including trailing ones — a `--` comment can contain a
 * semicolon, which would otherwise cut a statement in half. Assumes no `--` appears
 * inside a string literal, which holds for this schema.
 *
 * A `$$ … $$` body — a guarded migration in a `do` block — is carried through whole:
 * the semicolons inside it belong to the block, not to the script.
 */
export function schemaStatements() {
  const stripped = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--')
      return comment === -1 ? line : line.slice(0, comment)
    })
    .join('\n')

  const statements = []
  let current = ''
  // Odd segments are the insides of $$ … $$; only the even ones may be cut on ';'.
  stripped.split('$$').forEach((segment, index) => {
    if (index % 2 === 1) {
      current += `$$${segment}$$`
      return
    }
    const [first, ...rest] = segment.split(';')
    current += first
    for (const piece of rest) {
      statements.push(current)
      current = piece
    }
  })
  statements.push(current)

  return statements.map((statement) => statement.trim()).filter(Boolean)
}
