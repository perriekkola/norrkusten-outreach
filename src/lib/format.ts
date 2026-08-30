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

/**
 * Spots a draft where the model dropped Swedish letters and left newlines behind.
 *
 * Structured output makes the model write non-ASCII as a \uXXXX escape, and under
 * constrained decoding it sometimes emits a different valid escape instead — we have seen
 * "CE-märkning" come back as "CE-m\nrkning", every å/ä/ö replaced by a line break, halfway
 * through an otherwise perfect email. It is not something a reader forgives, and an
 * auto-send campaign posts it without anyone looking.
 *
 * A newline wedged between two lowercase letters is the tell: real paragraph breaks are
 * blank lines and real line breaks follow punctuation, so no correct draft contains one.
 * Checked against every draft this app has written — it flags the corrupt one and none
 * of the clean ones.
 */
export const looksMangled = (text: string) => /\p{Ll}\n\p{Ll}/u.test(text)

/**
 * Every placeholder a fixed campaign can use, what it renders to, and where it comes from.
 *
 * One source of truth: the campaign form lists these for the user to copy, and
 * fillTemplate resolves exactly these keys. A selftest asserts the two agree, so adding a
 * field here without teaching fillTemplate about it fails the build rather than shipping a
 * token the UI advertises and the renderer leaves as literal text.
 */
export const TEMPLATE_FIELDS = [
  {
    field: 'first_name',
    example: 'Anna',
    note: 'First name. Falls back to the first word of the full name.',
  },
  { field: 'full_name', example: 'Anna Berg', note: 'Full name as it was scraped.' },
  { field: 'company', example: 'Acme Ab', note: 'Company name.' },
] as const

/**
 * Fills the placeholders in a fixed campaign's subject or body.
 *
 * A truly byte-identical email to three hundred people reads as a mailshot and looks like
 * one to a spam filter, so the few fields worth varying are substituted here. Everything
 * else is passed through untouched — this is deliberately not a template language.
 *
 * Unknown placeholders are left alone rather than blanked: seeing {{firstname}} arrive in
 * a test send is how you find the typo, whereas a silent empty string is not.
 */
export function fillTemplate(
  text: string,
  lead: { first_name?: string | null; full_name?: string | null; company_name?: string | null },
): string {
  const first = (lead.first_name || lead.full_name?.split(/\s+/)[0] || '').trim()
  const values: Record<string, string> = {
    first_name: first,
    full_name: (lead.full_name || first || '').trim(),
    company: (lead.company_name || '').trim(),
  }
  // The optional leading space is captured so an empty value can take it with it: a lead
  // with no first name turns "Hej {{first_name}}," into "Hej," rather than "Hej ,".
  // Tidying the whole string afterwards instead would eat legitimate spacing, such as the
  // one in ", ...".
  return text.replace(/([^\S\n]?)\{\{\s*(\w+)\s*\}\}/g, (whole, space: string, field: string) => {
    if (!(field in values)) return whole
    const value = values[field]
    return value ? `${space}${value}` : ''
  })
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
 * The opt-out footer.
 *
 * ePrivacy 2002/58/EC art. 13(4) forbids marketing email without a valid address for
 * asking that it stop, and Swedish marknadsföringslagen (2008:486) §§19-21 requires the
 * same alongside an identifiable sender — the signature above covers the sender.
 *
 * It used to carry a second sentence naming where the address came from, which is what
 * GDPR art. 14 asks for when there is no existing customer relationship. Per asked for
 * the one line only on 2026-08-30. Putting the source disclosure back is a one-line
 * change here if that turns out to be wanted.
 */
const NOTICE = {
  sv: { lead: 'Vill du inte bli kontaktad igen', label: 'avregistrera dig' },
  en: { lead: 'If you would rather not hear from us', label: 'unsubscribe' },
} as const

export function unsubscribeNotice(url: string, language = 'sv') {
  const copy = NOTICE[language as keyof typeof NOTICE] ?? NOTICE.en
  return {
    text: `\n\n—\n${copy.lead}: ${url}`,
    // Deliberately smaller and grey: obliged to be there, not obliged to compete with
    // the message. Rendered outside textToHtml so the click rewriter never touches it —
    // a click-tracked opt-out reads as a dark pattern and would break one-click POST.
    html:
      `<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #e6e6e6;` +
      `font-size:11px;line-height:1.5;color:#8a8a8a">${copy.lead}: ` +
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
