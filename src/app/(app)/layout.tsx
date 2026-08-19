import Image from 'next/image'
import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { signOut } from '@/lib/actions'
import { Button } from '@/components/ui/button'
import { NavLink } from '@/components/nav-link'

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/searches', label: 'Searches' },
  { href: '/leads', label: 'Leads' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/outbox', label: 'Outbox' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings', label: 'Settings' },
] as const

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/80 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/" className="shrink-0">
            <Image src="/logo.svg" alt="Norrkusten" width={124} height={30} priority />
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <form action={signOut} className="flex items-center gap-3">
            <span className="text-muted-foreground hidden text-xs sm:inline">{user.email}</span>
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
