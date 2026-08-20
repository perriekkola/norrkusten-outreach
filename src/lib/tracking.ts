import crypto from 'node:crypto'

/** Opaque, unguessable token for the open-tracking pixel. */
function sign(payload: string) {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 16)
}

export const trackToken = (id: number) => `${id}-${sign(`track:${id}`)}`

/**
 * Click tokens sign the destination as well as the message, so the endpoint cannot be
 * turned into an open redirect by swapping the `u` parameter.
 */
export const clickToken = (id: number, url: string) => `${id}-${sign(`click:${id}:${url}`)}`

export function readClickToken(token: string, url: string): number | null {
  const [rawId, signature] = token.split('-')
  const id = Number(rawId)
  if (!Number.isFinite(id) || !signature) return null
  return signature === sign(`click:${id}:${url}`) ? id : null
}

/** Opt-out link. Signed per message, so the URL carries no address to harvest. */
export const unsubToken = (id: number) => `${id}-${sign(`unsub:${id}`)}`

export function readUnsubToken(token: string): number | null {
  const [rawId, signature] = token.split('-')
  const id = Number(rawId)
  if (!Number.isFinite(id) || !signature) return null
  return signature === sign(`unsub:${id}`) ? id : null
}

export function readTrackToken(token: string): number | null {
  const [rawId, signature] = token.split('-')
  const id = Number(rawId)
  if (!Number.isFinite(id) || !signature) return null
  return signature === sign(`track:${id}`) ? id : null
}

export function appUrl() {
  const explicit = process.env.APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return vercel ? `https://${vercel}` : ''
}
