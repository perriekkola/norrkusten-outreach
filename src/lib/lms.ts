import 'server-only'
import { db, getSetting, setSetting } from './db'

/**
 * Reads purchase history out of the LMS so a sale can be matched back to the email that
 * caused it. Server-only: the token is a full-scope API credential and must never reach a
 * browser, which the LMS docs say in as many words.
 *
 * The matching itself is not here — it is the `conversions` view, because attribution is a
 * join against leads and messages and belongs in the database rather than in a loop.
 */

const base = () => (process.env.LMS_BASE_URL ?? '').replace(/\/$/, '')

export const lmsConfigured = () => Boolean(base() && process.env.LMS_API_TOKEN)

/**
 * A missing route on the LMS answers 200 with the portal's own HTML — it is a single-page
 * app, so every unmatched path falls through to the shell. `res.ok` is therefore not
 * evidence of anything and the content type has to be checked, or the first sign of
 * trouble is a JSON parse error blaming the wrong thing.
 */
async function get(path: string, params: Record<string, string | number | undefined> = {}) {
  const token = process.env.LMS_API_TOKEN
  if (!base() || !token) throw new Error('LMS_BASE_URL and LMS_API_TOKEN are not set')

  const url = new URL(`${base()}/api/public/v1/${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  const body = await res.text()

  if (!res.ok) {
    // The documented error bodies are small and machine-readable; pass them through so
    // an insufficient_scope reads as itself rather than as "LMS 403".
    throw new Error(`LMS ${path} — ${res.status} ${body.slice(0, 200)}`)
  }
  if (!res.headers.get('content-type')?.includes('json') || body.trimStart().startsWith('<')) {
    throw new Error(
      `LMS ${path} answered HTML, not JSON — the endpoint does not exist yet on ${base()}`,
    )
  }
  return JSON.parse(body)
}

/**
 * Proves the token and base URL before anything depends on them, and probes the endpoint
 * that actually matters rather than the easy one. A token minted for the catalogue reads
 * courses happily and returns `insufficient_scope` here, which looks like a working
 * integration that quietly counts no conversions.
 */
export async function lmsCheck(): Promise<{ ok: boolean; detail: string }> {
  if (!lmsConfigured()) return { ok: false, detail: 'LMS_BASE_URL or LMS_API_TOKEN is not set' }
  try {
    const purchases = await get('purchases', { limit: 1 })
    const total = purchases.pagination?.total ?? purchases.count ?? 0
    return { ok: true, detail: `${total} purchase(s) readable` }
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error)
    return {
      ok: false,
      detail: message.includes('insufficient_scope')
        ? 'The token is valid but lacks the purchases:read scope — mint a new one under Admin → API.'
        : message,
    }
  }
}

type ApiPurchase = {
  id?: string | number
  created_at?: string
  purchased_at?: string
  updated_at?: string
  organization?: { name?: string; org_number?: string; contact_email?: string; billing_email?: string }
  course?: { course_code?: string; code?: string; title?: string }
  course_code?: string
  buyer_email?: string
  emails?: string[]
  participants?: { email?: string }[]
  quantity?: number
  unit_price_excl_vat?: number
  total_excl_vat?: number
  currency?: string
  payment_method?: string
  source?: string
  external_reference?: string
}

const address = (value: unknown) =>
  typeof value === 'string' && value.includes('@') ? value.trim().toLowerCase() : null

/**
 * Every address the purchase touches. `emails[]` is what was asked for, but the fallback
 * matters: if the LMS ships only participants and a buyer, attribution still works rather
 * than silently matching nothing.
 */
function addresses(row: ApiPurchase): string[] {
  const all = [
    ...(row.emails ?? []),
    row.buyer_email,
    row.organization?.contact_email,
    row.organization?.billing_email,
    ...(row.participants ?? []).map((p) => p?.email),
  ]
    .map(address)
    .filter((value): value is string => Boolean(value))
  return [...new Set(all)]
}

const domainsOf = (emails: string[]) => [
  ...new Set(emails.map((email) => email.split('@')[1]).filter(Boolean)),
]

/**
 * Pulls purchases into the local table. Incremental: only rows changed since the last
 * successful sync, with an hour of overlap so a purchase written while the previous sync
 * was mid-flight is not skipped for ever. Re-reading a handful of rows is free; missing
 * one is a conversion that never shows up.
 */
export async function syncPurchases(): Promise<{
  synced: number
  skipped: number
  error?: string
}> {
  if (!lmsConfigured()) return { synced: 0, skipped: 0, error: 'not configured' }

  const last = await getSetting('lms_purchases_synced_at')
  const since = last ? new Date(Date.parse(last) - 3_600_000).toISOString() : undefined
  const startedAt = new Date().toISOString()

  let synced = 0
  let skipped = 0
  try {
    // Paged rather than one big call, and capped: a first sync of a long history should
    // make progress every round instead of running the round out of time in one call.
    for (let offset = 0; offset < 2000; offset += 200) {
      const page = await get('purchases', { limit: 200, offset, updated_since: since })
      const rows = (page.data ?? []) as ApiPurchase[]
      if (!rows.length) break

      for (const row of rows) {
        const id = String(row.id ?? row.external_reference ?? '')
        const at = row.created_at ?? row.purchased_at
        // Without an id there is nothing to upsert against, and without a date there is
        // nothing to compare to a send. Counted rather than thrown: one malformed row
        // must not cost the whole sync.
        if (!id || !at || Number.isNaN(Date.parse(at))) {
          skipped++
          continue
        }

        const emails = addresses(row)
        const quantity = row.quantity ?? row.participants?.length ?? 1
        const total =
          row.total_excl_vat ??
          (row.unit_price_excl_vat != null ? row.unit_price_excl_vat * quantity : null)

        await db()`
          insert into purchases (id, purchased_at, org_name, org_number, course_code,
                                 course_title, emails, domains, quantity, total_excl_vat,
                                 currency, payment_method, source, raw, synced_at)
          values (${id}, ${at}, ${row.organization?.name ?? null},
                  ${row.organization?.org_number ?? null},
                  ${row.course?.course_code ?? row.course?.code ?? row.course_code ?? null},
                  ${row.course?.title ?? null}, ${emails}, ${domainsOf(emails)},
                  ${quantity}, ${total}, ${row.currency ?? 'SEK'},
                  ${row.payment_method ?? null}, ${row.source ?? null},
                  ${JSON.stringify(row)}::jsonb, now())
          on conflict (id) do update set
            purchased_at = excluded.purchased_at, org_name = excluded.org_name,
            org_number = excluded.org_number, course_code = excluded.course_code,
            course_title = excluded.course_title, emails = excluded.emails,
            domains = excluded.domains, quantity = excluded.quantity,
            total_excl_vat = excluded.total_excl_vat, currency = excluded.currency,
            payment_method = excluded.payment_method, source = excluded.source,
            raw = excluded.raw, synced_at = now()`
        synced++
      }

      if (!page.pagination?.has_more) break
    }
  } catch (error) {
    // The watermark is deliberately not moved on failure, so the next round re-reads the
    // same span rather than stepping over purchases nobody fetched.
    return { synced, skipped, error: String(error instanceof Error ? error.message : error) }
  }

  await setSetting('lms_purchases_synced_at', startedAt)
  return { synced, skipped }
}
