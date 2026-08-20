/**
 * Structured output from the Opus family sometimes comes back doubly escaped, so
 * JSON.parse yields "Fr\\u00e5n" as six literal characters rather than "Från".
 * Decoding per code unit is correct for surrogate pairs too: JS strings are UTF-16,
 * so the two halves concatenate back into one character.
 */
export function decodeEscapes(text: string): string {
  if (!/\\u[0-9a-fA-F]{4}/.test(text)) return text
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
}

/** The signature is configuration, not something to regenerate per email. */
export function withSignature(body: string, signature: string) {
  const trimmed = signature.trim()
  return trimmed ? `${body.trimEnd()}\n\n${trimmed}` : body
}

/**
 * One address, one row. Scrapers hand back ` Per@X.se `, `mailto:per@x.se` and
 * `Per Riekkola <per@x.se>` for the same person, and the unique index on `leads.email`
 * only stops the duplicate once they all collapse to the same string.
 */
export function normalizeEmail(raw: string): string {
  const angled = raw.match(/<([^>]+)>/)
  return (angled ? angled[1] : raw)
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '')
    .trim()
}

/**
 * The legally obliged footer, and nothing beyond it.
 *
 * ePrivacy 2002/58/EC art. 13(4) forbids marketing email without a valid address for
 * asking that it stop. Swedish marknadsföringslagen (2008:486) §§19-21 allows B2B
 * without prior consent but requires that opt-out, an identifiable sender, and — with
 * no existing customer relationship — where the address came from. GDPR art. 14 wants
 * the same source disclosure and art. 21(4) the right to object, stated at first
 * contact. One sentence covers all four; the sender's identity is the signature above.
 */
const NOTICE = {
  sv: {
    source:
      'Du får det här mejlet i din yrkesroll. Adressen kommer från en offentlig företagsdatabas.',
    lead: 'Vill du inte bli kontaktad igen',
    label: 'avregistrera dig',
  },
  en: {
    source:
      'You are receiving this in your professional capacity. Your address came from a public business database.',
    lead: 'If you would rather not hear from us',
    label: 'unsubscribe',
  },
} as const

export function unsubscribeNotice(url: string, language = 'sv') {
  const copy = NOTICE[language as keyof typeof NOTICE] ?? NOTICE.en
  return {
    text: `\n\n—\n${copy.source} ${copy.lead}: ${url}`,
    // Deliberately smaller and grey: obliged to be there, not obliged to compete with
    // the message. Rendered outside textToHtml so the click rewriter never touches it —
    // a click-tracked opt-out reads as a dark pattern and would break one-click POST.
    html:
      `<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #e6e6e6;` +
      `font-size:11px;line-height:1.5;color:#8a8a8a">${copy.source} ${copy.lead}: ` +
      `<a href="${url.replace(/&/g, '&amp;')}" style="color:#8a8a8a">${copy.label}</a>.</p>`,
  }
}

// Bare URLs in the plain-text body. Trailing punctuation is excluded so a sentence-final
// full stop or a closing bracket does not end up inside the href.
const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g

/** Plain text in, safe HTML out — Claude writes prose, not markup. Pure; unit-tested. */
export function textToHtml(
  body: string,
  pixelUrl?: string,
  linkUrl?: (url: string) => string,
  /** Pre-rendered trusted markup appended after the body. Never escaped — only ever
   *  unsubscribeNotice().html, which this module builds itself. */
  footerHtml?: string,
) {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const linked = linkUrl
    ? escaped.replace(URL_PATTERN, (url) => {
        const href = linkUrl(url).replace(/&/g, '&amp;')
        return `<a href="${href}" style="color:#2249ff">${url}</a>`
      })
    : escaped

  const paragraphs = linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, '<br />')}</p>`)
    .join('')
  const pixel = pixelUrl
    ? `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0" />`
    : ''
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${paragraphs}${footerHtml ?? ''}${pixel}</div>`
}
