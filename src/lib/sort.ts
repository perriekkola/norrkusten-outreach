/**
 * Sorting, the parts with no React in them.
 *
 * Deliberately separate from `components/sortable.tsx`: that file is `'use client'`, and
 * anything exported from a client module cannot be called by a server component — the page
 * would build fine and then throw "attempted to call from the server" at request time.
 * Server pages read the sort out of the URL and turn it into SQL, so those helpers live
 * here where both sides can reach them.
 */
export type SortDir = 'asc' | 'desc'
export type Sort<K extends string = string> = { key: K; dir: SortDir }

/**
 * What a click on a header does: sort ascending, then descending, then stop sorting.
 *
 * The third state matters — every one of these tables has a default order that means
 * something (the order emails go out, best score first), and there has to be a way back to
 * it that is not reloading the page.
 */
export function nextSort<K extends string>(current: Sort<K> | null, key: K): Sort<K> | null {
  if (current?.key !== key) return { key, dir: 'asc' }
  return current.dir === 'asc' ? { key, dir: 'desc' } : null
}

/** Reads `sort` and `dir` out of a URL, keeping only columns the page allows. */
export function sortFromParams<K extends string>(
  params: Record<string, string | string[] | undefined>,
  allowed: readonly K[],
): Sort<K> | null {
  const key = typeof params.sort === 'string' ? params.sort : ''
  if (!allowed.includes(key as K)) return null
  return { key: key as K, dir: params.dir === 'desc' ? 'desc' : 'asc' }
}

/**
 * Turns a validated sort into an `order by`, falling back to the list's natural order.
 *
 * `columns` is a whitelist, not a mapping built from the request: the result is
 * concatenated into SQL, so anything the user can influence is matched against a fixed set
 * before it gets near the query.
 */
export function orderBy(
  columns: Record<string, string>,
  sort: Sort | null,
  fallback: string,
): string {
  const column = sort && columns[sort.key]
  if (!column) return fallback
  const direction = sort.dir === 'desc' ? 'desc' : 'asc'
  // An empty cell is missing, not smallest — keep those out of the way either direction.
  return column
    .split(',')
    .map((part) => `${part.trim()} ${direction} nulls last`)
    .join(', ')
}

/** Client-side sort for a table that already holds every row it will ever show. */
export function sortRows<T, K extends string>(
  rows: T[],
  sort: Sort<K> | null,
  value: (row: T, key: K) => string | number | null,
): T[] {
  if (!sort) return rows
  return [...rows].sort((a, b) => {
    const left = value(a, sort.key)
    const right = value(b, sort.key)
    // Nulls last whichever way the column points: an empty cell is not a small value, it
    // is a missing one, and burying it under a descending sort hides the filled rows.
    if (left === null || left === '') return 1
    if (right === null || right === '') return -1
    const order =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'sv')
    return sort.dir === 'asc' ? order : -order
  })
}
