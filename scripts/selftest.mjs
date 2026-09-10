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

// Undeclared language is why Gmail offered to translate a Swedish email into Swedish.
assert.ok(textToHtml('Hej').includes('lang="sv"'), 'Swedish unless told otherwise')
assert.ok(textToHtml('Hi', undefined, undefined, undefined, 'en').includes('lang="en"'), 'lang honoured')

// A test send has no click tracking, and used to have no links either — Gmail linkifies a
// bare URL for you, Outlook leaves it as text, so it looked fine to the sender and arrived
// dead for the recipient.
const untracked = textToHtml('Läs mer:\nhttps://norrkusten.se/kurser/ce')
assert.ok(
  untracked.includes('<a href="https://norrkusten.se/kurser/ce"'),
  'a URL is a link even when clicks are not tracked',
)
const tracked = textToHtml('https://norrkusten.se/kurser/ce', undefined, (u) => `https://t.test/c?u=${u}`)
assert.ok(tracked.includes('href="https://t.test/c?u=https://norrkusten.se/kurser/ce"'), 'tracked href')
// The body is escaped before URLs are matched, so a query string arrives as &amp;.
const query = textToHtml('https://norrkusten.se/k?a=1&b=2')
assert.ok(
  query.includes('href="https://norrkusten.se/k?a=1&amp;b=2"'),
  'a query string is escaped exactly once in the href',
)
assert.ok(!query.includes('&amp;amp;'), 'and never double-escaped')
assert.ok(textToHtml('x', 'https://e.test/t/1-a').includes('<img'), 'pixel when URL given')

const { looksMangled } = await import('../src/lib/format.ts')

// The real corrupted draft: every a-ring/a-uml/o-uml replaced by a line break.
assert.ok(
  looksMangled('typ av ombyggnation som sker l\ntt i egen produktion'),
  'a newline inside a word is a mangled draft',
)
assert.ok(looksMangled('Vi har tagit fram en webbkurs om CE-m\nrkning enligt'), 'mid-word break')
// Everything a correct email actually contains must pass.
assert.ok(!looksMangled('Hej Thomas,\n\nI januari 2027 ers\u00e4tts Maskindirektivet.'), 'paragraph break is fine')
assert.ok(!looksMangled('en fr\u00e5ga.\nMed v\u00e4nliga h\u00e4lsningar'), 'break after punctuation is fine')
assert.ok(!looksMangled('CE-m\u00e4rkning och underh\u00e5ll g\u00e4ller f\u00f6r 2027'), 'clean Swedish text is fine')
assert.ok(!looksMangled('rad ett\nRad tv\u00e5'), 'break before a capital is fine')

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
const { isAutoReply, isBounce, referencedIds, replyText } = await import('../src/lib/format.ts')

// The quoted original is usually the longer half of a reply. Leaving it in means the
// model reads our own email back and classifies that instead of the answer.
const swedishReply = [
  'Hej Per,',
  '',
  'Tack, det här är intressant. Kan du skicka mer info om priset?',
  '',
  'Den 31 aug 2026 kl 09:12 skrev Per Riekkola <per@norrkusten.se>:',
  '> Nya maskinförordningen gäller från januari 2027',
  '> Läs mer här: https://norrkusten.se/kurser',
].join('\n')
const read = replyText(swedishReply)
assert.ok(read.includes('Kan du skicka mer info'), 'keeps what they wrote')
assert.ok(!read.includes('Nya maskinförordningen'), 'drops the quoted original')
assert.ok(!read.includes('skrev Per Riekkola'), 'drops the attribution line')

assert.ok(
  !replyText('Hej\n\n-----Original Message-----\nFrom: per@x.se\nHemligt').includes('Hemligt'),
  'drops an Outlook-style quote',
)
assert.equal(
  replyText('Content-Type: text/plain\n\n<p>Hej <b>Per</b></p>').replace(/\s+/g, ' ').trim(),
  'Hej Per',
  'strips MIME headers and tags',
)
assert.ok(replyText('a'.repeat(9000)).length < 4100, 'long replies are cut')

// Picking the part is what gets the reply decoded. Asking for BODY[TEXT] instead printed a
// real Outlook reply as "Tack f=F6r tipset" and handed the classifier the same, so this
// asserts the shape Outlook and Gmail actually send: an alternative pair, sometimes with
// the whole thing wrapped in multipart/mixed because a signature image rides along.
const { textPartPath } = await import('../src/lib/format.ts')
assert.equal(textPartPath({ type: 'text/plain' }), '1', 'a single-part mail is part 1')
assert.equal(
  textPartPath({
    type: 'multipart/alternative',
    childNodes: [
      { part: '1', type: 'text/plain' },
      { part: '2', type: 'text/html' },
    ],
  }),
  '1',
  'text/plain beats text/html',
)
assert.equal(
  textPartPath({
    type: 'multipart/mixed',
    childNodes: [
      {
        type: 'multipart/alternative',
        childNodes: [
          { part: '1.1', type: 'text/html' },
          { part: '1.2', type: 'text/plain' },
        ],
      },
      { part: '2', type: 'image/png', disposition: 'inline' },
    ],
  }),
  '1.2',
  'the nested text part is found',
)
// A forwarded .eml carries text parts of its own, and answering those means classifying
// somebody else's mail as this person's reply.
assert.equal(
  textPartPath({
    type: 'multipart/mixed',
    childNodes: [
      { part: '1', type: 'text/html' },
      {
        part: '2',
        type: 'message/rfc822',
        disposition: 'attachment',
        childNodes: [{ part: '2.1', type: 'text/plain' }],
      },
    ],
  }),
  '1',
  'an attached message is not the reply',
)
assert.equal(textPartPath(undefined), undefined, 'no structure, no part')


// Every one of these arrives with the original References attached, so without telling
// them apart they all count as a reply: the sequence stops and the reply rate reads high.
const REF = 'References: <a@x.se> <b@x.se>\n'

assert.ok(isAutoReply('Auto-Submitted: auto-replied\n'), 'RFC 3834 auto-replied')
assert.ok(isAutoReply('Auto-Submitted: auto-generated\n'), 'auto-generated too')
assert.ok(isAutoReply('Precedence: bulk\n'), 'bulk precedence')
assert.ok(isAutoReply('X-Autoreply: yes\n'), 'x-autoreply')
// Exchange puts this on ordinary mail to stop auto-replies coming back to it. Reading it
// as a sign of one flagged every reply sent from Microsoft 365, which is most of them.
assert.ok(
  !isAutoReply('X-Auto-Response-Suppress: DR, RN, NRN, OOF\n' + REF, 'Re: Nya maskinförordningen'),
  'a normal Outlook reply is not an auto-reply',
)
assert.ok(isAutoReply(REF, 'Automatiskt svar: Nya maskinförordningen'), 'Swedish out-of-office')
assert.ok(isAutoReply(REF, 'Out of Office'), 'English out-of-office')
// "no" is the one value meaning a person sent it.
assert.ok(!isAutoReply('Auto-Submitted: no\n' + REF, 'Re: Nya maskinförordningen'), 'a real reply')
// Getting this wrong here means emailing someone who did answer, which is the worse
// direction, so a bare mention of a holiday must not qualify.
assert.ok(!isAutoReply(REF, 'Re: kursen — efter semestern kanske?'), 'holiday talk is not an OOO')

assert.ok(isBounce('Content-Type: multipart/report; report-type=delivery-status\n'), 'DSN')
// A real one from the host, and the reason bounces must be judged before auto-replies: a
// delivery report is auto-submitted by definition, so asking "is this automatic?" first
// swallows every bounce as an out-of-office and the dead address is never marked.
const realBounce = 'References: <a@norrkusten.se>\nAuto-Submitted: auto-replied\n'
assert.ok(isAutoReply(realBounce), 'a bounce does look automatic')
assert.ok(
  isBounce(realBounce, 'Undeliverable: Nya maskinförordningen', 'support@one.com'),
  'and it is a bounce, which has to be checked first',
)
assert.ok(isBounce('X-Failed-Recipients: a@x.se\n'), 'failed recipients header')
assert.ok(isBounce('Return-Path: <>\n'), 'null return path')
assert.ok(isBounce(REF, 'Re: hej', 'MAILER-DAEMON@x.se'), 'daemon sender')
assert.ok(isBounce(REF, 'Undeliverable: Nya maskinförordningen'), 'Outlook wording')
assert.ok(!isBounce(REF, 'Re: Nya maskinförordningen', 'anna@acme.se'), 'a real reply')

// Only References supplies ids. The fetch asks for several headers now, and scanning all
// of them for <...> would pick up ids from headers that mean something else entirely.
assert.deepEqual(
  referencedIds('Return-Path: <bounce@x.se>\nReferences: <a@x.se> <b@x.se>\nPrecedence: bulk\n'),
  ['<a@x.se>', '<b@x.se>'],
  'ids come from References and nowhere else',
)
assert.deepEqual(referencedIds('Return-Path: <bounce@x.se>\n'), [], 'no References, no ids')

const { fillTemplate, TEMPLATE_FIELDS } = await import('../src/lib/format.ts')

// Every placeholder the form offers has to be one the renderer actually fills in.
for (const { field } of TEMPLATE_FIELDS) {
  const filled = fillTemplate(`x{{${field}}}x`, {
    first_name: 'Anna',
    full_name: 'Anna Berg',
    company_name: 'Acme Ab',
  })
  assert.ok(
    !filled.includes('{{'),
    `{{${field}}} is advertised in the campaign form but fillTemplate leaves it as text`,
  )
}

// A fixed campaign sends exactly what was typed, with only these filled in per lead.
const anna = { first_name: 'Anna', full_name: 'Anna Berg', company_name: 'Acme Ab' }
assert.equal(
  fillTemplate('Hej {{first_name}}, hur ser det ut hos {{company}}?', anna),
  'Hej Anna, hur ser det ut hos Acme Ab?',
  'fills the fields it knows',
)
assert.equal(fillTemplate('{{ full_name }}', anna), 'Anna Berg', 'tolerates padding')
assert.equal(
  fillTemplate('Hej {{firstname}}', anna),
  'Hej {{firstname}}',
  'an unknown field is left visible, not silently blanked',
)
// first_name is often missing from a scraped row; the greeting must still read properly.
assert.equal(
  fillTemplate('Hej {{first_name}}, ...', { full_name: 'Bo Ek', company_name: null }),
  'Hej Bo, ...',
  'falls back to the first word of the full name',
)
assert.equal(
  fillTemplate('Hej {{first_name}}, hur är läget?', { full_name: null, company_name: null }),
  'Hej, hur är läget?',
  'no name at all leaves "Hej," rather than "Hej ,"',
)
assert.equal(
  fillTemplate('rad ett\nrad två', anna),
  'rad ett\nrad två',
  'newlines survive the whitespace tidy-up',
)

const { normalizeEmail, unsubscribeNotice } = await import('../src/lib/format.ts')
for (const raw of [' Per@X.se ', 'PER@X.SE', 'mailto:per@x.se', 'Per Riekkola <Per@X.se>']) {
  assert.equal(normalizeEmail(raw), 'per@x.se', `normalises ${JSON.stringify(raw)}`)
}

// The legally obliged footer: present, and pointing at the opt-out.
const notice = unsubscribeNotice('https://e.test/api/u/7-abc', 'sv')
assert.ok(notice.text.includes('https://e.test/api/u/7-abc'), 'plain text carries the URL')
assert.ok(notice.html.includes('href="https://e.test/api/u/7-abc"'), 'html links to it')
assert.ok(/avregistrera/i.test(notice.html), 'Swedish wording for a Swedish campaign')
assert.ok(
  !/yrkesroll|företagsdatabas/i.test(notice.text),
  'the footer is the opt-out line only — the source sentence was deliberately removed',
)
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

/* ------------------------------------------------------- city spellings */

// The actor's index holds no Swedish letters, so a city typed the Swedish way matched
// nothing and said nothing about it. Each expected form here was read back out of a
// lead the actor itself returned.
const { citySpellings } = await import('../src/lib/apify-options.ts')
for (const [typed, expected] of [
  ['Luleå', 'lulea'],
  ['Malmö', 'malmoe'],
  ['Jönköping', 'joenkoeping'],
  ['Västerås', 'vaesteras'],
  ['Södertälje', 'soedertaelje'],
  ['Västra Frölunda', 'vaestra froelunda'],
  // A word that starts with the letter just loses its dots: Örebro, not Oerebro.
  ['Örebro', 'orebro'],
  ['Östersund', 'ostersund'],
  ['Ånge', 'ange'],
]) {
  assert.deepEqual(
    citySpellings(typed),
    [typed.toLowerCase(), expected],
    `${typed} is asked for both ways`,
  )
}
assert.deepEqual(citySpellings('Boden'), ['boden'], 'a city with no Swedish letters is asked once')

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

/* ------------------------------------------------- leads filter + paging */

// The Leads list and "enroll everything matching" run the same where clause from
// leadFilter(). If they ever disagree, the page promises a count it does not enrol.
const { leadFilter, LEADS_PER_PAGE } = await import('../src/lib/leads.ts')

await db.exec(`
  insert into searches (id, label, input, status) values
    (7, 'Paged search', '{}'::jsonb, 'ready'),
    (8, 'Other search', '{}'::jsonb, 'ready');
  select setval(pg_get_serial_sequence('leads','id'), 100);
  select setval(pg_get_serial_sequence('enrollments','id'), 100);
  insert into leads (email, full_name, company_name, job_title)
  select 'p' || g || '@paged.se', 'Person ' || g, 'Acme ' || g, 'Konstruktionschef'
    from generate_series(1, 25) g;
  insert into leads (email, full_name, company_name, job_title)
  values ('other@elsewhere.se', 'Other One', 'Elsewhere', 'VD');
  insert into lead_searches (search_id, lead_id)
  select 7, id from leads where email like '%@paged.se';
  insert into lead_searches (search_id, lead_id)
  select 8, id from leads where email = 'other@elsewhere.se';
`)

const { where, params } = leadFilter({ query: '', source: 7 })
const [{ total }] = await q(`select count(*)::int as total from leads l where ${where}`, params)
assert.equal(total, 25, 'filter counts only the leads of the chosen search')

// Page through with the page query and check the union is every row, exactly once.
const seen = new Set()
for (let page = 0; page * 10 < total; page++) {
  const rows = await q(
    `select l.id from leads l where ${where} order by l.created_at desc limit $3 offset $4`,
    [...params, 10, page * 10],
  )
  for (const row of rows) seen.add(row.id)
}
assert.equal(seen.size, total, 'paging covers every matching lead with no gaps or repeats')
assert.ok(LEADS_PER_PAGE > 0, 'page size is set')

// Text search has to reach every column the page offers, and stay inside the filter.
const named = leadFilter({ query: 'Person 1', source: 7 })
assert.ok(
  (await q(`select 1 from leads l where ${named.where}`, named.params)).length > 0,
  'query matches on full_name',
)
const crossed = leadFilter({ query: 'Elsewhere', source: 7 })
assert.equal(
  (await q(`select 1 from leads l where ${crossed.where}`, crossed.params)).length,
  0,
  'a company match in another search is still excluded by the source filter',
)

// What "enroll all matching" actually inserts — suppressed addresses must not come along.
await db.exec(`insert into suppressions (email, reason, source) values ('p3@paged.se', 'asked', 'manual')`)
const enrolled = await q(
  `insert into enrollments (campaign_id, lead_id)
   select $3, l.id from leads l
    where ${where} and l.status <> 'rejected'
      and not exists (select 1 from suppressions s
                       where s.email = l.email
                          or (left(s.email, 1) = '@' and right(l.email, length(s.email)) = s.email))
   on conflict (campaign_id, lead_id) do nothing
   returning id`,
  [...params, 1],
)
assert.equal(enrolled.length, 24, 'enroll-all-matching takes every match but the suppressed one')

/* ----------------------------------------- a search re-finding known leads */

// The reported bug: search, campaign, delete both, search again with the same
// parameters — and only a few leads came back. `on conflict (email) do nothing` gave
// the second search nothing to return, so it looked empty while the leads sat there
// with a dangling source. This mirrors importDataset(): the lead row is written once,
// the membership row every time a search finds them.
const importOne = async (searchId, email) =>
  (
    await q(
      `with lead as (
         insert into leads (email, full_name) values ($2, 'Reimported')
         on conflict (email) do update set email = excluded.email
         returning id
       )
       insert into lead_searches (search_id, lead_id)
       select $1, id from lead
       on conflict do nothing
       returning lead_id`,
      [searchId, email],
    )
  ).length

await db.exec(`
  insert into searches (id, label, input, status) values
    (9, 'First run', '{}'::jsonb, 'ready'),
    (10, 'Same run again', '{}'::jsonb, 'ready'),
    (11, 'Overlapping', '{}'::jsonb, 'ready');
`)

assert.equal(await importOne(9, 'again@dup.se'), 1, 'a new address imports')
assert.equal(await importOne(9, 'again@dup.se'), 0, 'the same search does not count them twice')

// Delete the search the way the app does. The lead survives; the membership goes.
await q(`delete from searches where id = 9`)
assert.equal(
  (await q(`select 1 from leads where email = 'again@dup.se'`)).length,
  1,
  'deleting a search leaves the leads alone',
)

assert.equal(
  await importOne(10, 'again@dup.se'),
  1,
  're-running the same search finds the lead again instead of importing nothing',
)
const reFound = leadFilter({ query: '', source: 10 })
assert.equal(
  (await q(`select 1 from leads l where ${reFound.where}`, reFound.params)).length,
  1,
  'and the leads page shows them under the new search',
)

// Two live searches that overlap: the lead belongs to both, neither steals them.
assert.equal(await importOne(11, 'again@dup.se'), 1, 'an overlapping search counts them too')
for (const searchId of [10, 11]) {
  const seen = leadFilter({ query: '', source: searchId })
  assert.equal(
    (await q(`select 1 from leads l where ${seen.where}`, seen.params)).length,
    1,
    `search ${searchId} still has the lead`,
  )
}
assert.equal(
  (await q(`select count(*)::int as n from leads where email = 'again@dup.se'`))[0].n,
  1,
  'and there is still only one of them',
)

/* ------------------------------------------------- removed enrollments */

// Removing someone has to survive the next campaign pass. The automatic enrol must step
// over the row; enrolling by hand must be able to undo it. Both go through the same
// unique (campaign_id, lead_id), so the two upserts are what decides this.
const [victim] = await q(`select id from leads where email = 'p9@paged.se'`)

const autoEnrol = (leadId) =>
  q(
    `insert into enrollments (campaign_id, lead_id) values (2, $1)
     on conflict (campaign_id, lead_id) do nothing
     returning id`,
    [leadId],
  )
const manualEnrol = (leadId) =>
  q(
    `insert into enrollments (campaign_id, lead_id) values (2, $1)
     on conflict (campaign_id, lead_id) do update set status = 'active'
       where enrollments.status = 'removed'
     returning id`,
    [leadId],
  )
const statusOf = async (leadId) =>
  (await q(`select status from enrollments where campaign_id = 2 and lead_id = $1`, [leadId]))[0]
    ?.status

assert.equal((await autoEnrol(victim.id)).length, 1, 'first automatic enrol creates the row')
assert.equal(await statusOf(victim.id), 'active', 'and it starts active')

await q(`update enrollments set status = 'removed' where campaign_id = 2 and lead_id = $1`, [
  victim.id,
])
await autoEnrol(victim.id)
assert.equal(
  await statusOf(victim.id),
  'removed',
  'a campaign pass must not re-enrol someone who was removed',
)

await manualEnrol(victim.id)
assert.equal(
  await statusOf(victim.id),
  'active',
  'enrolling by hand from the Leads page undoes a removal',
)

// A reply is not a removal: hand-enrolling must not restart a sequence someone answered.
await q(`update enrollments set status = 'replied' where campaign_id = 2 and lead_id = $1`, [
  victim.id,
])
await manualEnrol(victim.id)
assert.equal(
  await statusOf(victim.id),
  'replied',
  'a replied enrollment is never revived by re-enrolling',
)

// Re-scoring clears the whole verdict, and spares anyone already emailed.
await q(
  `update enrollments set score = 30, verdict = 'weak', reasons = 'r', angle = 'a'
    where campaign_id = 1`,
)
const [emailed] = await q(`select enrollment_id from messages where status = 'sent' limit 1`)
await q(
  `update enrollments set score = null, verdict = null, reasons = null, angle = null
    where campaign_id = 1 and status <> 'removed'
      and id not in (select enrollment_id from messages where status = 'sent')`,
)
assert.equal(
  (await q(`select 1 from enrollments where campaign_id = 1 and score is not null`)).length,
  emailed ? 1 : 0,
  'only enrollments with a sent email keep their score through a re-score',
)

/* ------------------------------------------------------------------- runs */

// One row per round, written at the start and closed at the end. The update has to find
// the row it opened, or a round that fails leaves nothing behind and the Runs page shows
// a round still going for ever.
const [opened] = await q(`insert into runs (started_at) values (now()) returning id`)
assert.ok(opened?.id, 'a round can open its row')

await q(
  `update runs set finished_at = now(), ok = true, result = $2::jsonb where id = $1`,
  [opened.id, JSON.stringify({ sent: 3, drafted: 1, throttled: false })],
)
const [done] = await q(`select ok, result, finished_at from runs where id = $1`, [opened.id])
assert.equal(done.ok, true, 'and close it')
assert.equal(done.result.sent, 3, 'with what it did readable back out of jsonb')
assert.ok(done.finished_at, 'and a finish time, which is what "still going" keys off')

const [failed] = await q(`insert into runs (started_at) values (now()) returning id`)
await q(`update runs set finished_at = now(), ok = false, error = $2 where id = $1`, [
  failed.id,
  'boom',
])
assert.equal(
  (await q(`select error from runs where ok = false`))[0].error,
  'boom',
  'a round that threw records why',
)

/* ------------------------------------------------------- purchase matching */

// The whole point of the feature: a purchase days after an email counts, and one that
// arrives before it or long after it does not. Four leads, four purchases, one view.
await q(`insert into settings (key, value) values ('attribution_window_days', '90')
         on conflict (key) do update set value = excluded.value`)

await q(`insert into leads (id, email, company_name, company_domain) values
  (901, 'thomas@st1.com',   'St1 Sverige AB', 'st1.com'),
  (902, 'anna@nordvik.se',  'Nordvik Bygg AB', 'nordvik.se'),
  (903, 'per@sandvik.com',  'Sandviken Industri AB', 'sandviken-industri.se'),
  (904, 'ola@ingenkop.se',  'Ingen Köp AB', 'ingenkop.se')`)
await q(`insert into campaigns (id, name) values (900, 'Conversion test')`)
await q(`insert into enrollments (id, campaign_id, lead_id) values
  (901, 900, 901), (902, 900, 902), (903, 900, 903), (904, 900, 904)`)
await q(`insert into messages (enrollment_id, lead_id, step, subject, body, status, sent_at) values
  (901, 901, 0, 's', 'b', 'sent', now() - interval '30 days'),
  (902, 902, 0, 's', 'b', 'sent', now() - interval '30 days'),
  (903, 903, 0, 's', 'b', 'sent', now() - interval '30 days'),
  (904, 904, 0, 's', 'b', 'sent', now() - interval '30 days')`)

await q(`insert into purchases (id, purchased_at, org_name, emails, domains, total_excl_vat) values
  -- A colleague on the same domain bought: the case that started this.
  ('p-domain', now() - interval '25 days', 'St1 Sverige AB',
   '{"inkop@st1.com"}', '{"st1.com"}', 4990),
  -- The person mailed bought themselves.
  ('p-email',  now() - interval '20 days', 'Nordvik Bygg AB',
   '{"anna@nordvik.se"}', '{"nordvik.se"}', 2495),
  -- Right company, different domain than the one we mailed. Name match earns it.
  ('p-name',   now() - interval '10 days', 'Sandviken Industri',
   '{"faktura@sandviken.nu"}', '{"sandviken.nu"}', 7000),
  -- Before the email went out, so the email cannot have caused it.
  ('p-before', now() - interval '40 days', 'Ingen Köp AB',
   '{"ola@ingenkop.se"}', '{"ingenkop.se"}', 999),
  -- Nobody we ever emailed.
  ('p-cold',   now() - interval '5 days',  'Okänd AB',
   '{"x@okand.se"}', '{"okand.se"}', 1234)`)

const matched = await q(`select purchase_id, lead_id, matched_on from conversions order by purchase_id`)
const byId = Object.fromEntries(matched.map((r) => [r.purchase_id, r]))
assert.equal(byId['p-domain']?.matched_on, 'domain', 'a colleague on the mailed domain converts')
assert.equal(Number(byId['p-domain']?.lead_id), 901, 'and is credited to the lead we mailed')
assert.equal(byId['p-email']?.matched_on, 'email', 'an exact address match converts')
assert.equal(byId['p-name']?.matched_on, 'company', 'company name is the cross-domain fallback')
assert.ok(!byId['p-before'], 'a purchase made before the first email is not a conversion')
assert.ok(!byId['p-cold'], 'a purchase by someone never emailed is not a conversion')

// The window is a setting, and shortening it has to actually exclude the slower sale.
// What matters is the lag from the first email, not the age of the purchase: every lead
// here was mailed 30 days ago, so p-domain lags 5 days, p-email 10 and p-name 20.
await q(`update settings set value = '15' where key = 'attribution_window_days'`)
const narrow = (await q(`select purchase_id from conversions`)).map((r) => r.purchase_id)
assert.ok(!narrow.includes('p-name'), 'a sale 20 days after the email falls outside a 15-day window')
assert.ok(narrow.includes('p-email'), 'one 10 days after it stays inside')
await q(`update settings set value = '90' where key = 'attribution_window_days'`)

// Two colleagues mailed, one purchase. Revenue must not be counted twice, which is why
// the view is one row per purchase rather than one per matching lead.
await q(`insert into leads (id, email, company_name, company_domain)
         values (905, 'kollega@st1.com', 'St1 Sverige AB', 'st1.com')`)
await q(`insert into enrollments (id, campaign_id, lead_id) values (905, 900, 905)`)
await q(`insert into messages (enrollment_id, lead_id, step, subject, body, status, sent_at)
         values (905, 905, 0, 's', 'b', 'sent', now() - interval '28 days')`)
assert.equal(
  (await q(`select count(*)::int as n from conversions where purchase_id = 'p-domain'`))[0].n,
  1,
  'one purchase is one conversion however many colleagues were emailed',
)
assert.equal(
  Number((await q(`select coalesce(sum(total_excl_vat),0) as t from conversions`))[0].t),
  4990 + 2495 + 7000,
  'and revenue sums each purchase once',
)

// Licences handed out of a pool arrive as their own zero-kronor rows. Real data had one
// order showing up as three conversions this way, so the count has to ignore them while
// the paid order it came from still counts.
await q(`insert into purchases (id, purchased_at, org_name, emails, domains, total_excl_vat, source) values
  ('p-pool',   now() - interval '18 days', 'Nordvik Bygg AB', '{"anna@nordvik.se"}', '{"nordvik.se"}', 9000, 'web'),
  ('p-draw-1', now() - interval '17 days', 'Nordvik Bygg AB', '{"anna@nordvik.se"}', '{"nordvik.se"}', 0, 'license_credit'),
  ('p-draw-2', now() - interval '16 days', 'Nordvik Bygg AB', '{"anna@nordvik.se"}', '{"nordvik.se"}', 0, 'license_credit')`)
const nordvik = (await q(`select purchase_id from conversions where org_name = 'Nordvik Bygg AB'`))
  .map((r) => r.purchase_id)
assert.ok(nordvik.includes('p-pool'), 'the paid order counts')
assert.ok(!nordvik.includes('p-draw-1'), 'a licence drawn from the pool does not')
assert.ok(!nordvik.includes('p-draw-2'), 'however many are drawn')
// An order keyed in by hand is still an order — only pool draws are excluded.
await q(`insert into purchases (id, purchased_at, org_name, emails, domains, total_excl_vat, source)
         values ('p-admin', now() - interval '12 days', 'St1 Sverige AB',
                 '{"inkop@st1.com"}', '{"st1.com"}', 4000, 'admin')`)
assert.equal(
  (await q(`select count(*)::int as n from conversions where purchase_id = 'p-admin'`))[0].n,
  1,
  'a purchase entered in the admin portal counts like any other',
)
await q(`delete from purchases where id in ('p-pool','p-draw-1','p-draw-2','p-admin')`)

// An exact address match must outrank a domain match for the same purchase, so the
// credited lead is the person who actually bought.
await q(`update purchases set emails = '{"kollega@st1.com","inkop@st1.com"}'
          where id = 'p-domain'`)
const [best] = await q(`select lead_id, matched_on from conversions where purchase_id = 'p-domain'`)
assert.equal(best.matched_on, 'email', 'the stronger match wins')
assert.equal(Number(best.lead_id), 905, 'and credits the address that appears on the purchase')

/* ------------------------------------------------- buying stops the sequence */

// Following up "are you interested?" to someone who already paid is the one outcome
// worth failing a build over. Several campaigns here sell the same course under different
// angles, so the rule is the whole company, every campaign — `won_enrollments`.
await q(`insert into campaigns (id, name) values (910, 'Same course, other angle')`)
// A colleague at the buying company, and a stranger somewhere else.
await q(`insert into leads (id, email, company_name, company_domain) values
  (906, 'kollega2@nordvik.se', 'Nordvik Bygg AB', 'nordvik.se'),
  (907, 'someone@annanfirma.se', 'Annan Firma AB', 'annanfirma.se')`)
await q(`insert into enrollments (id, campaign_id, lead_id) values
  (910, 910, 902), (906, 900, 906), (907, 900, 907)`)
await q(`insert into messages (enrollment_id, lead_id, step, subject, body, status) values
  (902, 902, 1, 'follow up', 'b', 'approved'),
  (910, 902, 0, 'other angle', 'b', 'draft'),
  (906, 906, 0, 'colleague', 'b', 'approved')`)

const target = (await q(`select id, lead_id from won_enrollments order by id`)).map((r) => Number(r.id))
assert.ok(target.includes(902), 'the campaign that sold them stops')
assert.ok(target.includes(910), 'and so does another campaign to the same person')
assert.ok(target.includes(906), 'and a colleague on the same domain, who may already have a seat')
assert.ok(!target.includes(907), 'a company that has not bought is left alone')

const won = await q(
  `update enrollments e set status = 'won' where e.id in (select id from won_enrollments)
   returning e.id, e.lead_id`,
)
await q(
  `update messages set status = 'skipped'
    where enrollment_id = any($1::int[]) and status in ('draft', 'approved')`,
  [won.map((r) => r.id)],
)
assert.equal(
  (await q(`select status from messages where enrollment_id = 902 and step = 1`))[0].status,
  'skipped',
  'an already-approved email is dropped, not left in the outbox to go out next round',
)
assert.equal(
  (await q(`select status from messages where enrollment_id = 906`))[0].status,
  'skipped',
  "and so is the colleague's",
)
assert.equal(
  (await q(`select status from messages where enrollment_id = 907`)).length,
  0,
  'nothing was queued for the untouched company to begin with',
)

// Drafting and sending both gate on 'active', so 'won' is what actually stops the work.
assert.equal(
  (await q(`select count(*)::int as n from enrollments
             where lead_id in (902, 906) and status = 'active'`))[0].n,
  0,
  'nothing is left active at a company that bought',
)
assert.equal(
  (await q(`select status from enrollments where id = 907`))[0].status,
  'active',
  'and the unrelated company keeps running',
)

// A shared mail provider is not a company. Without the guard in lead_companies, one
// purchase from a gmail address would stop every gmail lead in the database.
await q(`insert into leads (id, email, company_name, company_domain) values
  (908, 'kopare@gmail.com', 'Enmansfirma', ''),
  (909, 'obekant@gmail.com', 'Annan Enmansfirma', '')`)
await q(`insert into campaigns (id, name) values (920, 'Freemail test')`)
await q(`insert into enrollments (id, campaign_id, lead_id) values (908, 920, 908), (909, 920, 909)`)
await q(`insert into messages (enrollment_id, lead_id, step, subject, body, status, sent_at) values
  (908, 908, 0, 's', 'b', 'sent', now() - interval '20 days'),
  (909, 909, 0, 's', 'b', 'sent', now() - interval '20 days')`)
await q(`insert into purchases (id, purchased_at, org_name, emails, domains, total_excl_vat, source)
         values ('p-gmail', now() - interval '10 days', 'Enmansfirma',
                 '{"kopare@gmail.com"}', '{"gmail.com"}', 1500, 'web')`)
const freemail = (await q(`select id from won_enrollments`)).map((r) => Number(r.id))
assert.ok(freemail.includes(908), 'the address on the purchase still stops — that is an exact match')
assert.ok(
  !freemail.includes(909),
  'but a stranger sharing the mail provider does not: gmail.com is not a company',
)
assert.equal(
  (await q(`select matched_on from conversions where purchase_id = 'p-gmail'`))[0].matched_on,
  'email',
  'and the match is credited to the address, never to the provider domain',
)

// Stopping a colleague's sequence is not the same as them buying. Marking all twenty
// leads at a company won would read as twenty customers where there are three.
await q(`update leads set status = 'won'
          where id in (select lead_id from conversions) and status <> 'won'`)
assert.equal(
  (await q(`select status from leads where id = 902`))[0].status,
  'won',
  'the lead the purchase is credited to is won',
)
assert.notEqual(
  (await q(`select status from leads where id = 906`))[0].status,
  'won',
  'a colleague whose sequence stopped is not — their company bought, they did not',
)

// Re-running must not undo a reply or a bounce that was recorded first.
await q(`update enrollments set status = 'replied' where id = 910`)
await q(`update enrollments e set status = 'won' where e.id in (select id from won_enrollments)`)
assert.equal(
  (await q(`select status from enrollments where id = 910`))[0].status,
  'replied',
  'a status that is not active is never overwritten, however often the sync runs',
)

// Enrolling again must not revive them: the insert relies on the unique pair.
await q(`insert into enrollments (campaign_id, lead_id) values (900, 902)
         on conflict (campaign_id, lead_id) do nothing`)
assert.equal(
  (await q(`select status from enrollments where campaign_id = 900 and lead_id = 902`))[0].status,
  'won',
  'the next enrolment pass cannot set a won lead back to active',
)

await db.close()
console.log('selftest: all checks passed')
