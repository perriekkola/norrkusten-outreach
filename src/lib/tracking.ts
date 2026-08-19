import crypto from 'node:crypto'

/** Opaque, unguessable token for the open-tracking pixel. */
function sign(id: number) {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return crypto.createHmac('sha256', secret).update(`track:${id}`).digest('base64url').slice(0, 16)
}

export const trackToken = (id: number) => `${id}-${sign(id)}`

export function readTrackToken(token: string): number | null {
  const [rawId, signature] = token.split('-')
  const id = Number(rawId)
  if (!Number.isFinite(id) || !signature) return null
  return signature === sign(id) ? id : null
}

export function appUrl() {
  const explicit = process.env.APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return vercel ? `https://${vercel}` : ''
}
