import crypto from 'node:crypto'

/**
 * AES-256-GCM for mailbox passwords. They are credentials to a third-party account,
 * so they must not sit in the database in the clear — but they have to be recoverable
 * to authenticate to SMTP, which rules out hashing.
 *
 * The key is derived from AUTH_SECRET. Changing AUTH_SECRET therefore invalidates every
 * stored password and they must be re-entered; the settings page says so.
 */
function key() {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set — mailbox passwords cannot be decrypted')
  return crypto.scryptSync(secret, 'mailbox-v1', 32)
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.')
}

export function decrypt(blob: string): string {
  const [iv, tag, body] = blob.split('.').map((part) => Buffer.from(part, 'base64'))
  if (!iv || !tag || !body) throw new Error('Stored password is malformed')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}
