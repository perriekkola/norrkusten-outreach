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
const { encrypt, decrypt } = await import('../src/lib/secrets.ts')

/* ------------------------------------------------------------ pure helpers */

const html = textToHtml('Hej <script>alert("x")</script>\nrad två\n\nnytt stycke')
assert.ok(!html.includes('<script>'), 'script tags must be escaped')
assert.ok(html.includes('&lt;script&gt;'), 'escaped form expected')
assert.ok(html.includes('<br />'), 'single newline becomes <br>')
assert.equal((html.match(/<p /g) ?? []).length, 2, 'blank line splits paragraphs')
assert.ok(!textToHtml('x').includes('<img'), 'no pixel without a URL')
assert.ok(textToHtml('x', 'https://e.test/t/1-a').includes('<img'), 'pixel when URL given')

const { withSignature, decodeEscapes } = await import('../src/lib/format.ts')
assert.equal(
  decodeEscapes('Fr\\u00e5n 2027 till\\u00e4mpas'),
  'Från 2027 tillämpas',
  'doubly-escaped unicode is decoded',
)
assert.equal(decodeEscapes('Från 2027'), 'Från 2027', 'clean text is untouched')
assert.equal(decodeEscapes('C:\\path\\to'), 'C:\\path\\to', 'ordinary backslashes survive')
assert.equal(decodeEscapes('\\ud83d\\ude00'), '😀', 'surrogate pairs rejoin')

assert.equal(withSignature('Hej.', 'Rickard'), 'Hej.\n\nRickard', 'signature follows a blank line')
assert.equal(withSignature('Hej.\n\n', 'Rickard'), 'Hej.\n\nRickard', 'trailing space is not doubled')
assert.equal(withSignature('Hej.', '   '), 'Hej.', 'a blank signature adds nothing')

const { formatDetail } = await import('../src/lib/stream.ts')
assert.equal(
  formatDetail('https://norrkusten.se/nya-maskinforordningen/'),
  'norrkusten.se/nya-maskinforordningen',
  'a URL that fits keeps its path, minus the trailing slash',
)
assert.equal(
  formatDetail(`https://norrkusten.se/${'kurser/'.repeat(9)}`),
  'norrkusten.se/…',
  'a URL that does not fit collapses to its host',
)
assert.ok(
  formatDetail('https://norrkusten.se/' + 'x'.repeat(300)).length <= 44,
  'no URL can exceed the cap',
)
assert.ok(formatDetail('x'.repeat(200)).length <= 44, 'plain text is clipped')
assert.equal(formatDetail(undefined), '', 'no detail renders nothing')

const { matchLocations } = await import('../src/lib/apify-options.ts')
assert.deepEqual(matchLocations(['Sweden', ' norway ']), ['sweden', 'norway'], 'case and spacing')
assert.deepEqual(matchLocations(['norrland']), [], 'a location Apify does not know is dropped')
assert.deepEqual(matchLocations(['sweden', 'Sweden']), ['sweden'], 'duplicates collapse')

// Every shape a scraper hands back for one person has to collapse to one row, because
// the unique index on leads.email is the only thing stopping the duplicate.
const { normalizeEmail, unsubscribeNotice } = await import('../src/lib/format.ts')
for (const raw of [' Per@X.se ', 'PER@X.SE', 'mailto:per@x.se', 'Per Riekkola <Per@X.se>']) {
  assert.equal(normalizeEmail(raw), 'per@x.se', `normalises ${JSON.stringify(raw)}`)
}

// The legally obliged footer: present, and pointing at the opt-out.
const notice = unsubscribeNotice('https://e.test/api/u/7-abc', 'sv')
assert.ok(notice.text.includes('https://e.test/api/u/7-abc'), 'plain text carries the URL')
assert.ok(notice.html.includes('href="https://e.test/api/u/7-abc"'), 'html links to it')
assert.ok(/avregistrera/i.test(notice.html), 'Swedish wording for a Swedish campaign')
assert.ok(/unsubscribe/i.test(unsubscribeNotice('https://e.test/u', 'en').html), 'English fallback')

// The opt-out must never be routed through the click tracker: that reads as a dark
// pattern and would break the one-click POST.
const withNotice = textToHtml('Hej https://norrkusten.se/kurs', undefined, (u) => `TRACKED:${u}`, notice.html)
assert.ok(withNotice.includes('TRACKED:https://norrkusten.se/kurs'), 'body links are rewritten')
assert.ok(withNotice.includes('href="https://e.test/api/u/7-abc"'), 'the opt-out link is not')
assert.ok(!textToHtml('Hej').includes('avregistrera'), 'no notice unless one is passed in')

const { unsubToken, readUnsubToken } = await import('../src/lib/tracking.ts')
assert.equal(readUnsubToken(unsubToken(7)), 7, 'opt-out token round-trips')
assert.equal(readUnsubToken('7-deadbeefdeadbeef'), null, 'forged opt-out token rejected')
assert.notEqual(unsubToken(7), trackToken(7), 'opt-out and pixel tokens are not interchangeable')
assert.equal(readUnsubToken(trackToken(7)), null, 'a pixel token cannot unsubscribe anyone')

assert.equal(readTrackToken(trackToken(42)), 42, 'token round-trips')
assert.equal(readTrackToken('42-deadbeefdeadbeef'), null, 'forged signature rejected')
assert.equal(readTrackToken('43' + trackToken(42).slice(2)), null, 'id swap rejected')
assert.equal(readTrackToken('nonsense'), null, 'garbage rejected')

// Mailbox passwords must survive a round trip and must not be readable at rest.
const password = 'hunter2-åäö-🔐'
const sealed = encrypt(password)
assert.equal(decrypt(sealed), password, 'password round-trips through AES-GCM')
assert.ok(!sealed.includes(password), 'ciphertext does not contain the plaintext')
assert.notEqual(encrypt(password), encrypt(password), 'a fresh IV each time, so no repeats')
assert.throws(() => decrypt(sealed.slice(0, -4) + 'AAAA'), 'a tampered ciphertext is rejected')

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

// Rewriting drops unsent drafts so they can be written again; sent mail is untouchable.
await db.exec(`
  insert into messages (id, enrollment_id, lead_id, step, subject, body, status)
  values (90, 1, 1, 1, 'Draft', 'Body', 'draft'),
         (91, 1, 1, 2, 'Skipped', 'Body', 'skipped');
`)
assert.deepEqual(
  await q(
    `select id from messages where id = any($1::int[]) and status <> 'sent' order by id`,
    [[1, 90, 91]],
  ),
  [{ id: 90 }, { id: 91 }],
  'a rewrite targets drafts and skipped steps, never the sent message',
)
await db.query(`delete from messages where id = any($1::int[]) and status <> 'sent'`, [[1, 90, 91]])
assert.deepEqual(
  await q(`select id from messages order by id`),
  [{ id: 1 }],
  'only the sent message survives a rewrite',
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

// A campaign can carry several links; the drafter is given the whole list.
await db.query(`update campaigns set links = $1::text[] where id = 1`, [
  ['https://a.test/kurs', 'https://b.test/kurs'],
])
assert.deepEqual(
  (await q(`select links from campaigns where id = 1`))[0].links,
  ['https://a.test/kurs', 'https://b.test/kurs'],
  'links round-trip as a text[]',
)
assert.deepEqual(
  (await q(`select links from campaigns where id = 2`))[0].links,
  [],
  'a campaign with no links defaults to empty, not null',
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

/* ------------------------------------------------------------- suppression */

// The whole point of keying by address: it has to outlive the lead row, or deleting
// someone and re-importing them from a later search puts them back in a campaign.
const SUPPRESSED = `
  exists (select 1 from suppressions s
           where s.email = %EMAIL%
              or (left(s.email, 1) = '@' and right(%EMAIL%, length(s.email)) = s.email))`
const leadSuppressed = SUPPRESSED.replaceAll('%EMAIL%', 'l.email')

await db.exec(`
  insert into suppressions (email, source) values ('c@d.se', 'unsubscribe'), ('@blocked.se', 'manual');
  insert into leads (id, email, full_name) values (5, 'x@blocked.se', 'X'), (6, 'ok@fine.se', 'OK');
`)

assert.deepEqual(
  await q(`select l.id from leads l where ${leadSuppressed} order by l.id`),
  [{ id: 2 }, { id: 5 }],
  'an exact address and an @domain entry both match; nobody else does',
)

// A domain entry must not match a lookalike suffix — 'notblocked.se' ends with
// 'blocked.se' but is a different company.
await db.exec(`insert into leads (id, email) values (7, 'y@notblocked.se')`)
assert.deepEqual(
  await q(`select l.id from leads l where ${leadSuppressed} and l.id = 7`),
  [],
  'a domain entry matches on the @ boundary, not on any suffix',
)

// The enrol query has to skip them, or every suppressed lead still costs a scoring call.
await db.exec(`update leads set search_id = null where id > 0`)
assert.deepEqual(
  await q(
    `select l.id from leads l where l.status <> 'rejected' and not ${leadSuppressed} order by l.id`,
  ),
  [{ id: 1 }, { id: 3 }, { id: 4 }, { id: 6 }, { id: 7 }],
  'enrolment skips suppressed leads',
)

/* ------------------------------------------------------------- send pacing */

// Rolling 24 hours per mailbox, with pre-mailbox_id rows falling into the default bucket.
await db.exec(`
  insert into mailboxes (id, name, from_email, smtp_host, smtp_user, smtp_pass, is_default)
  values (1, 'Main', 'a@n.se', 'smtp', 'u', 'p', true), (2, 'Other', 'b@n.se', 'smtp', 'u', 'p', false);
  insert into messages (enrollment_id, lead_id, step, subject, body, status, mailbox_id, sent_at)
  values (1, 1, 10, 's', 'b', 'sent', 1,    now() - interval '2 hours'),
         (1, 1, 11, 's', 'b', 'sent', 1,    now() - interval '30 hours'),
         (1, 1, 12, 's', 'b', 'sent', 2,    now() - interval '1 hour'),
         (1, 1, 13, 's', 'b', 'sent', null, now() - interval '3 hours');
`)
assert.deepEqual(
  await q(`
    select coalesce(m.mailbox_id, (select id from mailboxes where is_default order by id limit 1), 0)
             as mailbox_id,
           count(*)::int as sent
      from messages m
     where m.status = 'sent' and m.sent_at > now() - interval '24 hours'
     group by 1 order by 1`),
  [
    { mailbox_id: 1, sent: 2 },
    { mailbox_id: 2, sent: 1 },
  ],
  'the 30-hour-old send has aged out; the pre-mailbox_id row counts against the default',
)

// One person, one email — the guard that stops five campaigns mailing the same lead.
assert.equal(
  (await q(
    `select 1 from messages
      where lead_id = $1 and id <> $2 and status = 'sent'
        and sent_at > now() - make_interval(days => $3::int) limit 1`,
    [1, -1, 3],
  )).length,
  1,
  'a lead emailed 2 hours ago is inside a 3-day cooldown',
)
assert.equal(
  (await q(
    `select 1 from messages
      where lead_id = $1 and id <> $2 and status = 'sent'
        and sent_at > now() - make_interval(days => $3::int) limit 1`,
    [3, -1, 3],
  )).length,
  0,
  'a lead we never emailed is not held back',
)

await db.close()
console.log('selftest: all checks passed')
