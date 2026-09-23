import crypto from 'node:crypto'

/** Opaque, unguessable token for the open-tracking pixel. */
function sign(payload: string) {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 16)
}

export const trackToken = (id: number) => `${id}-${sign(`track:${id}`)}`

/**
 * Splits `id-signature` at the first dash only. The signature is base64url, which has `-`
 * in its alphabet, so about one token in five carries a dash of its own. Splitting on every
 * dash cut those signatures short and rejected them: dead opt-out links, 400s on clicks.
 */
function verify(token: string, payload: (id: number) => string): number | null {
  const match = /^(\d+)-(.+)$/.exec(token)
  if (!match) return null
  const id = Number(match[1])
  return match[2] === sign(payload(id)) ? id : null
}

/**
 * Click tokens sign the destination as well as the message, so the endpoint cannot be
 * turned into an open redirect by swapping the `u` parameter.
 */
export const clickToken = (id: number, url: string) => `${id}-${sign(`click:${id}:${url}`)}`

export const readClickToken = (token: string, url: string) =>
  verify(token, (id) => `click:${id}:${url}`)

/** Opt-out link. Signed per message, so the URL carries no address to harvest. */
export const unsubToken = (id: number) => `${id}-${sign(`unsub:${id}`)}`

export const readUnsubToken = (token: string) => verify(token, (id) => `unsub:${id}`)

export const readTrackToken = (token: string) => verify(token, (id) => `track:${id}`)

export function appUrl() {
  const explicit = process.env.APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return vercel ? `https://${vercel}` : ''
}
