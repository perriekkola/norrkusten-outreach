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

// A trailing `--` comment may contain a semicolon; the splitter must not cut there.
assert.ok(
  schemaStatements().some((st) => st.includes('research') && st.includes('create table')),
  'leads table survives inline comments containing semicolons',
)

const db = new PGlite()
for (const statement of schemaStatements()) {
  await db.exec(statement)
}

/* ---------------------------------------------------------------- fixtures */

await db.exec(`
  insert into campaigns (id, name, icp, offer, min_score, steps)
  values (1, 'Test', 'Maskinbyggare', 'Kurser', 50,
          '[{"delay_days":0,"goal":"intro"},{"delay_days":3,"goal":"bump"}]'),
         (2, 'Other', 'Entreprenad', 'Kurser', 50, '[{"delay_days":0,"goal":"intro"}]');
  insert into leads (id, email, full_name) values (1, 'a@b.se', 'A B'), (2, 'c@d.se', 'C D');
  insert into enrollments (id, campaign_id, lead_id, score, verdict)
  values (1, 1, 1, 90, 'strong'), (2, 2, 1, 20, 'weak');
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

// The whole point of moving scoring onto enrollments: one lead, two verdicts.
const perCampaign = await q(
  `select campaign_id, score from enrollments where lead_id = 1 order by campaign_id`,
)
assert.deepEqual(
  perCampaign,
  [
    { campaign_id: 1, score: 90 },
    { campaign_id: 2, score: 20 },
  ],
  'a lead holds a different score per campaign',
)

// Research is fetched once per company and reused; drafting only fetches when absent.
await db.exec(`update leads set research = 'brief' where id = 1`)
assert.deepEqual(
  await q(`select id from leads where research is null order by id`),
  [{ id: 2 }],
  'only the unresearched lead would trigger a fetch',
)

// Sending walks the score order and never touches anyone below the campaign floor.
await db.exec(`
  insert into leads (id, email, full_name) values (3, 'e@f.se', 'E F'), (4, 'g@h.se', 'G H');
  insert into enrollments (id, campaign_id, lead_id, score, next_send_at)
  values (3, 1, 3, 95, now() - interval '1 hour'),
         (4, 1, 4, 10, now() - interval '1 hour');
  update enrollments set next_send_at = now() - interval '1 hour', score = 60 where id = 1;
`)
assert.deepEqual(
  await q(`select e.id from enrollments e join campaigns c on c.id = e.campaign_id
            where e.status = 'active' and c.status = 'active' and e.next_send_at <= now()
              and e.score >= c.min_score
            order by e.score desc, e.next_send_at`),
  [{ id: 3 }, { id: 1 }],
  'due list is best-first and excludes the below-floor lead',
)

// Optional date params go in as null, never ''. On Neon, `$1 = '' or col >= $1::date`
// fails with 22007 because ''::date is folded before the OR short-circuits. PGlite does
// not reproduce that, so this only pins the shape that works — the guard is the pattern
// itself, not this assertion.
assert.equal(
  (await q(`select 1 as ok where ($1::date is null or now() >= $1::date)`, [null])).length,
  1,
  'null date param means unbounded',
)

// Analytics date range: `to` is inclusive, so the bound is `< to + 1 day`.
await db.exec(`update messages set sent_at = date '2026-03-10' + interval '20 hours' where id = 1`)
assert.equal(
  (await q(
    `select id from messages
      where ($1 = '' or sent_at >= $1::date) and ($2 = '' or sent_at < $2::date)`,
    ['2026-03-10', '2026-03-11'],
  )).length,
  1,
  'a message late on the end date is inside the range',
)
assert.equal(
  (await q(
    `select id from messages
      where ($1 = '' or sent_at >= $1::date) and ($2 = '' or sent_at < $2::date)`,
    ['2026-03-11', '2026-03-12'],
  )).length,
  0,
  'and outside a later range',
)
assert.equal(
  (await q(
    `select to_char(d::date, 'YYYY-MM-DD') as day from generate_series(
        coalesce($1::date, current_date - 29), coalesce($2::date, current_date), interval '1 day') d`,
    ['2026-03-01', '2026-03-07'],
  )).length,
  7,
  'activity series spans the chosen range inclusively',
)

const [funnel] = await q(`
  select (select count(*) from leads)::int as leads,
         (select count(*) from messages where status = 'sent')::int as sent,
         (select count(distinct lead_id) from enrollments)::int as enrolled`)
assert.deepEqual(funnel, { leads: 4, sent: 1, enrolled: 3 }, 'funnel aggregate')

assert.equal(
  (await q(`select id from enrollments where campaign_id = $1 and score is null`, [1])).length,
  0,
  'unscored lookup used by the campaign page',
)

const filtered = await q(
  `select * from leads
    where ($1 = 'all' or status = $1)
      and ($2 = '' or full_name ilike $3 or email ilike $3)`,
  ['all', 'a b', '%a b%'],
)
assert.equal(filtered.length, 1, 'lead search filter')

const allEnrollments = (await q(`select id from enrollments`)).length
assert.equal(
  (await q(`select id from enrollments
             where ($1::int is null or campaign_id = $1::int)`, [null])).length,
  allEnrollments,
  'optional campaign filter: null means every campaign',
)
assert.equal(
  (await q(`select id from enrollments
             where ($1::int is null or campaign_id = $1::int)`, [2])).length,
  1,
  'optional campaign filter: narrows to one campaign',
)

await db.close()
console.log('selftest: all checks passed')
