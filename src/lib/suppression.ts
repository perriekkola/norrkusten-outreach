import 'server-only'
import { db } from './db'
import { normalizeEmail } from './format'

/**
 * The do-not-contact list. Deliberately keyed by address rather than by lead id: it has
 * to outlive the lead row, or deleting someone and re-importing them from a later search
 * would quietly put them back into a campaign.
 *
 * An entry beginning with '@' suppresses the whole domain, which is what "take our
 * company off your list" actually means.
 */

/** SQL fragment reused everywhere a lead's address must be checked. Suffix-compared
 *  rather than `like`, so an underscore in a stored entry stays a literal underscore. */
const MATCH = `
  exists (select 1 from suppressions s
           where s.email = %EMAIL%
              or (left(s.email, 1) = '@' and right(%EMAIL%, length(s.email)) = s.email))`

/** Addresses out of the given list that are suppressed. Empty list in, empty list out. */
export async function suppressedAmong(emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set()
  const rows = (await db().query(
    `select e from unnest($1::text[]) e where ${MATCH.replaceAll('%EMAIL%', 'e')}`,
    [emails],
  )) as { e: string }[]
  return new Set(rows.map((row) => row.e))
}

export async function isSuppressed(email: string): Promise<boolean> {
  return (await suppressedAmong([normalizeEmail(email)])).size > 0
}

/** Predicate for the `leads` table, for use inside a larger query. */
export const LEAD_IS_SUPPRESSED = MATCH.replaceAll('%EMAIL%', 'l.email')

/**
 * Adds an address (or '@domain') and stops everything already in flight for it: active
 * enrollments end, unsent drafts are skipped. Without that second half an opt-out only
 * takes effect for mail we have not written yet, which is not what it promises.
 */
export async function suppress(rawEmail: string, reason: string, source: string) {
  const email = normalizeEmail(rawEmail)
  if (!email.includes('@')) throw new Error('Not an address')

  await db()`
    insert into suppressions (email, reason, source) values (${email}, ${reason}, ${source})
    on conflict (email) do update set reason = excluded.reason, source = excluded.source`

  const leads = (await db().query(
    `select l.id from leads l where ${LEAD_IS_SUPPRESSED}`,
  )) as { id: number }[]
  const ids = leads.map((lead) => lead.id)
  if (!ids.length) return 0

  await db()`update leads set status = 'rejected' where id = any(${ids}::int[])`
  await db()`
    update enrollments set status = 'stopped'
     where lead_id = any(${ids}::int[]) and status = 'active'`
  await db()`
    update messages set status = 'skipped'
     where lead_id = any(${ids}::int[]) and status in ('draft', 'approved')`
  return ids.length
}

export async function unsuppress(rawEmail: string) {
  await db()`delete from suppressions where email = ${normalizeEmail(rawEmail)}`
}
