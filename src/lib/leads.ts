import 'server-only'

/**
 * The Leads page filter, as SQL.
 *
 * Shared by the list query and by "enroll everything matching", because those two must
 * agree on what "matching" means — a user who reads "975 matching" and presses enroll is
 * promised those exact 975. Two hand-written copies of the same where clause is how that
 * promise quietly breaks the next time a filter is added.
 *
 * Placeholders start at $1; the caller appends its own params after `params`.
 */
export type LeadFilter = { query: string; source: number | null }

export function leadFilter({ query, source }: LeadFilter) {
  return {
    where: `($1::int is null or l.search_id = $1::int)
        and ($2 = '' or l.full_name ilike '%' || $2 || '%'
             or l.email ilike '%' || $2 || '%'
             or l.company_name ilike '%' || $2 || '%'
             or l.job_title ilike '%' || $2 || '%')`,
    params: [source, query] as unknown[],
  }
}

/** Rows per page on the Leads list. */
export const LEADS_PER_PAGE = 100
