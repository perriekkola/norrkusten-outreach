// Smallest thing that fails if the risky logic breaks:
//   1. schema.sql actually applies to Postgres
//   2. the hand-written queries with casts / generate_series parse and run
//   3. the tracking token can't be forged
//   4. email bodies are HTML-escaped
// Run: npm test    (uses PGlite — no database server needed)
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { schemaStatements } from './sql.mjs'

process.env.AUTH_SECRET ||= 'test-secret'

const { textToHtml } = await import('../src/lib/format.ts')
const { trackToken, readTrackToken } = await import('../src/lib/tracking.ts')

/* ------------------------------------------------------------ pure helpers */

const html = textToHtml('Hej <script>alert("x")</script>\nrad två\n\nnytt stycke')
assert.ok(!html.includes('<script>'), 'script tags must be escaped')
assert.ok(html.includes('&lt;script&gt;'), 'escaped form expected')
assert.ok(html.includes('<br />'), 'single newline becomes <br>')
assert.equal((html.match(/<p /g) ?? []).length, 2, 'blank line splits paragraphs')
assert.ok(!textToHtml('x').includes('<img'), 'no pixel without a URL')
assert.ok(textToHtml('x', 'https://e.test/t/1-a').includes('<img'), 'pixel when URL given')

assert.equal(readTrackToken(trackToken(42)), 42, 'token round-trips')
assert.equal(readTrackToken('42-deadbeefdeadbeef'), null, 'forged signature rejected')
assert.equal(readTrackToken('43' + trackToken(42).slice(2)), null, 'id swap rejected')
assert.equal(readTrackToken('nonsense'), null, 'garbage rejected')

/* ------------------------------------------------------------------ schema */

const db = new PGlite()
for (const statement of schemaStatements()) {
  await db.exec(statement)
}

/* ---------------------------------------------------------------- fixtures */

await db.exec(`
  insert into campaigns (id, name, offer, steps)
  values (1, 'Test', 'Kurser', '[{"delay_days":0,"goal":"intro"},{"delay_days":3,"goal":"bump"}]');
  insert into leads (id, email, full_name) values (1, 'a@b.se', 'A B'), (2, 'c@d.se', 'C D');
  insert into enrollments (id, campaign_id, lead_id) values (1, 1, 1);
  insert into messages (id, enrollment_id, lead_id, step, subject, body, status, provider_id, sent_at)
  values (1, 1, 1, 0, 'Hej', 'Body', 'sent', '<abc@one.com>', now());
  select setval(pg_get_serial_sequence('messages','id'), 1);
`)

// ponytail: these mirror the app's trickiest queries. If you edit those, edit these.
const q = async (sql, params) => (await db.query(sql, params)).rows

assert.equal(
  (await q(`update enrollments set step = 1,
              next_send_at = now() + make_interval(days => $1::int)
            where id = 1 returning id`, [3])).length,
  1,
  'make_interval with a bound param',
)

assert.equal(
  (await q(`update leads set status = 'replied' where id = any($1::int[]) returning id`, [[1, 2]]))
    .length,
  2,
  'int[] bulk update',
)

assert.equal(
  (await q(`select id from messages where provider_id = any($1::text[]) and status = 'sent'`, [
    ['<abc@one.com>', '<other@x>'],
  ])).length,
  1,
  'text[] reply matching',
)

assert.equal(
  (await q(
    `select to_char(d::date, 'YYYY-MM-DD') as day,
       (select count(*) from messages
         where sent_at >= d and sent_at < d + interval '1 day')::int as sent
       from generate_series(current_date - 29, current_date, interval '1 day') d order by d`,
  )).length,
  30,
  '30-day activity series',
)

const [funnel] = await q(`
  select (select count(*) from leads)::int as leads,
         (select count(*) from messages where status = 'sent')::int as sent,
         (select count(distinct lead_id) from enrollments)::int as enrolled`)
assert.deepEqual(funnel, { leads: 2, sent: 1, enrolled: 1 }, 'funnel aggregate')

const filtered = await q(
  `select * from leads
    where ($1 = 'all' or status = $1)
      and ($2 = '' or full_name ilike $3 or email ilike $3)`,
  ['all', 'a b', '%a b%'],
)
assert.equal(filtered.length, 1, 'lead search filter')

assert.equal(
  (await q(`select id from enrollments
             where ($1::int is null or campaign_id = $1::int)`, [null])).length,
  1,
  'optional campaign filter',
)

await db.close()
console.log('selftest: all checks passed')
