import { redirect } from 'next/navigation'
import { Logo } from '@/components/logo'
import { currentUser, userCount } from '@/lib/auth'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in' }

export default async function LoginPage() {
  if (await currentUser()) redirect('/')

  let firstRun = false
  let dbError = false
  try {
    firstRun = (await userCount()) === 0
  } catch (error) {
    // Public page — log the detail, never render it.
    console.error('login: database unavailable', error)
    dbError = true
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <Logo className="h-9 w-auto" />
        {dbError ? (
          <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-4 text-sm">
            <p className="font-medium">Temporarily unavailable</p>
            <p className="mt-1 opacity-80">
              The service can&apos;t reach its database. The details are in the server logs.
            </p>
          </div>
        ) : (
          <LoginForm firstRun={firstRun} />
        )}
      </div>
    </main>
  )
}
