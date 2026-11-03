import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { xlsx } from '@/lib/xlsx'

// Everyone this search found, as an Excel sheet of company, name, title and email. Reads
// lead_searches, so a lead first imported by an earlier search is still on the list.
export async function GET(_request: Request, context: RouteContext<'/api/searches/[id]/export'>) {
  await requireUser()
  const { id } = await context.params

  const searches = (await db()`select label from searches where id = ${Number(id)}`) as {
    label: string
  }[]
  if (!searches[0]) return new Response('No such search.', { status: 404 })

  const leads = (await db()`
    select l.company_name, l.full_name, l.first_name, l.last_name, l.job_title, l.email
      from leads l join lead_searches ls on ls.lead_id = l.id
     where ls.search_id = ${Number(id)}
     order by lower(coalesce(l.company_name, '')), lower(coalesce(l.full_name, l.first_name, ''))`) as {
    company_name: string | null
    full_name: string | null
    first_name: string | null
    last_name: string | null
    job_title: string | null
    email: string
  }[]

  const { label } = searches[0]
  const file = xlsx(label, [
    ['Företag', 'Namn', 'Titel', 'E-post'],
    ...leads.map((lead) => [
      lead.company_name ?? '',
      lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' '),
      lead.job_title ?? '',
      lead.email,
    ]),
  ])

  const name = `${label.replace(/[\\/:*?"<>|]/g, ' ').trim() || `search-${id}`}.xlsx`
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // The plain filename is the ASCII fallback; filename* carries å, ä and ö intact.
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
