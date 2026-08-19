import Image from 'next/image'
import { redirect } from 'next/navigation'
import { currentUser, userCount } from '@/lib/auth'
import { LoginForm } from './login-form'

export default async function LoginPage() {
  if (await currentUser()) redirect('/')

  let firstRun = false
  let dbError: string | null = null
  try {
    firstRun = (await userCount()) === 0
  } catch (error) {
    dbError = String(error)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <Image src="/logo.svg" alt="Norrkusten" width={166} height={40} priority />
        {dbError ? (
          <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-4 text-sm">
            <p className="font-medium">Database not reachable</p>
            <p className="mt-1 break-words opacity-80">{dbError}</p>
            <p className="mt-2 opacity-80">
              Set <code>DATABASE_URL</code>, then run <code>npm run db:push</code>.
            </p>
          </div>
        ) : (
          <LoginForm firstRun={firstRun} />
        )}
      </div>
    </main>
  )
}
