/** The signature is configuration, not something to regenerate per email. */
export function withSignature(body: string, signature: string) {
  const trimmed = signature.trim()
  return trimmed ? `${body.trimEnd()}\n\n${trimmed}` : body
}

// Bare URLs in the plain-text body. Trailing punctuation is excluded so a sentence-final
// full stop or a closing bracket does not end up inside the href.
const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g

/** Plain text in, safe HTML out — Claude writes prose, not markup. Pure; unit-tested. */
export function textToHtml(body: string, pixelUrl?: string, linkUrl?: (url: string) => string) {
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
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${paragraphs}${pixel}</div>`
}
