import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { Logo } from '@/components/logo'
import { MobileNav } from '@/components/mobile-nav'
import { NavLink } from '@/components/nav-link'
import { UserMenu } from '@/components/user-menu'

/** The daily path through the tool, left to right. */
const WORK = [
  { href: '/', label: 'Dashboard' },
  { href: '/searches', label: 'Searches' },
  { href: '/leads', label: 'Leads' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/outbox', label: 'Outbox' },
] as const

/** Looked at occasionally, so kept out of the run of pages you move through. */
const ASIDE = [
  { href: '/runs', label: 'Runs' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings', label: 'Settings' },
] as const

/** The drawer has room for one list, and order of use is the right order there. */
const NAV = [...WORK, ...ASIDE]

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
            {WORK.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* One group, so the only space between Settings and the avatar is this gap.
              Separate children would each pick up the header's lg:gap-6 as well, which put
              32px there against the 4px between the nav links themselves. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <nav className="hidden items-center gap-1 lg:flex">
              {ASIDE.map((item) => (
                <NavLink key={item.href} href={item.href}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <UserMenu email={user.email} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
