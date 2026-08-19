import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { Logo } from '@/components/logo'
import { MobileNav } from '@/components/mobile-nav'
import { NavLink } from '@/components/nav-link'
import { UserMenu } from '@/components/user-menu'

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
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 lg:gap-6">
          <MobileNav items={NAV} />

          <Link href="/" className="shrink-0">
            <Logo className="h-7 w-auto" />
          </Link>

          {/* Seven links need ~830px alongside the logo and avatar, so the inline nav
              only appears at lg. Below that it lives in the drawer. */}
          <nav className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto shrink-0 lg:ml-0">
            <UserMenu email={user.email} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
