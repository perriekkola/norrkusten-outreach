'use client'

import Link from 'next/link'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { nextSort, type Sort } from '@/lib/sort'
import { cn } from '@/lib/utils'

/**
 * A sortable column header, for both kinds of table this app has.
 *
 * Tables holding every row sort in the browser and pass `onSort`. Tables that only hold
 * one page have to sort in the database — sorting the hundred rows you can see would put
 * the highest score on the page in front, not the highest score there is — so those pass
 * `href` and navigate instead.
 */
export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  href,
  className,
}: {
  label: string
  sortKey: K
  sort: Sort<K> | null
  onSort?: (next: Sort<K> | null) => void
  href?: (next: Sort<K> | null) => string
  className?: string
}) {
  const active = sort?.key === sortKey
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  const style = 'hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap'
  const inner = (
    <>
      {label}
      <Icon className={cn('size-3', active ? 'opacity-80' : 'opacity-30')} />
    </>
  )

  return (
    <TableHead className={className}>
      {href ? (
        <Link href={href(nextSort(sort, sortKey))} className={style} scroll={false}>
          {inner}
        </Link>
      ) : (
        <button type="button" className={style} onClick={() => onSort?.(nextSort(sort, sortKey))}>
          {inner}
        </button>
      )}
    </TableHead>
  )
}
