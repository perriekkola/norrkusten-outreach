// Applies schema.sql to DATABASE_URL. Idempotent.  `npm run db:push`
import { neon } from '@neondatabase/serverless'
import { schemaStatements } from './sql.mjs'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env.local (or run `vercel env pull`).')
  process.exit(1)
}

const sql = neon(url)
const statements = schemaStatements()

for (const statement of statements) {
  await sql.query(statement)
  console.log('ok:', statement.split('\n')[0].slice(0, 70))
}
console.log(`\nApplied ${statements.length} statements.`)
