'use client'

import { Menu } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logo } from '@/components/logo'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export function MobileNav({ items }: { items: readonly { href: string; label: string }[] }) {
  const pathname = usePathname()

  return (
    <Sheet>
      <SheetTrigger
        className="hover:bg-accent -ml-2 rounded-md p-2 lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </SheetTrigger>

      <SheetContent side="left">
        <SheetHeader className="border-b">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Logo className="h-7 w-auto" />
        </SheetHeader>

        <nav className="flex flex-col gap-0.5 px-2">
          {items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            return (
              // SheetClose closes the drawer on navigation — the layout persists across routes.
              <SheetClose key={item.href} asChild>
                <Link
                  href={item.href}
                  className={cn(
                    'rounded-md px-3 py-2.5 text-sm transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  {item.label}
                </Link>
              </SheetClose>
            )
          })}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
