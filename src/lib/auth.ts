import 'server-only'
import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { db } from './db'

const COOKIE = 'nk_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function secret() {
  const value = process.env.AUTH_SECRET
  if (!value) throw new Error('AUTH_SECRET is not set — generate one with `openssl rand -base64 32`')
  return value
}

const sign = (payload: string) =>
  crypto.createHmac('sha256', secret()).update(payload).digest('base64url')

function issue(userId: number) {
  const payload = `${userId}.${Date.now() + MAX_AGE_SECONDS * 1000}`
  return `${payload}.${sign(payload)}`
}

function verify(token: string): number | null {
  const [id, expires, signature] = token.split('.')
  if (!id || !expires || !signature) return null
  const expected = sign(`${id}.${expires}`)
  if (signature.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  if (Number(expires) < Date.now()) return null
  return Number(id)
}

export async function currentUser(): Promise<{ id: number; email: string } | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  const id = verify(token)
  if (!id) return null
  const rows = (await db()`select id, email from users where id = ${id}`) as {
    id: number
    email: string
  }[]
  return rows[0] ?? null
}

/** Use at the top of every protected layout / server action. */
export async function requireUser() {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}

export async function startSession(userId: number) {
  ;(await cookies()).set(COOKIE, issue(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function endSession() {
  ;(await cookies()).delete(COOKIE)
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10)
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash)

export async function userCount(): Promise<number> {
  const rows = (await db()`select count(*)::int as n from users`) as { n: number }[]
  return rows[0]?.n ?? 0
}
