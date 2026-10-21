// Small pieces every section shares: the team tag (the hero's hanging-sign
// plate), the one thin check, arrows, the section head and responsive plates.
export type Team = 'Identity' | 'Checkout' | 'Inventory' | 'Payments' | 'Data' | 'Edge'

export const tag = (team: Team) => `<span class="tag">${team}</span>`

/** The one done mark: a thin sea-glass check. */
export const check = '<svg class="ok" viewBox="0 0 16 16" aria-label="done" role="img"><path d="M3 8.6l3.1 3.1L13 4.6"/></svg>'

/** Section head: the eyebrow (subject, team and date), two heading lines (ink, then the gradient) and the lead. */
// A heading line never ends on one word alone: its last two words stay together.
const keepLastTwo = (line: string) => line.replace(/ (\S+)$/, '\u00a0$1')

export function head({ id, eyebrow, line1, line2, lead, align = 'left' }: { id: string; eyebrow: string; line1: string; line2: string; lead?: string; align?: 'left' | 'center' }): string {
  return `<header class="head head-${align}"><p class="eyebrow">${eyebrow}</p>`
    + `<h2 id="${id}"><span class="l1">${keepLastTwo(line1)}</span> <span class="l2">${keepLastTwo(line2)}</span></h2>`
    + `${lead ? `<p class="lead">${lead}</p>` : ''}</header>`
}

/** A painted plate as AVIF with a WebP fallback at the widths encoded under public/site. */
export function plate({ name, widths, sizes, alt, cls, width, height, eager = false }: { name: string; widths: number[]; sizes: string; alt: string; cls?: string; width: number; height: number; eager?: boolean }): string {
  const set = (ext: string) => widths.map(w => `/site/${name}-${w}.${ext} ${w}w`).join(', ')
  return `<picture${cls ? ` class="${cls}"` : ''}><source type="image/avif" srcset="${set('avif')}" sizes="${sizes}"><source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">`
    + `<img src="/site/${name}-${widths[Math.min(2, widths.length - 1)]}.webp" alt="${alt}" width="${width}" height="${height}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"></picture>`
}

/** The mark and wordmark, as the header and the footer set them. */
export const lockup = (cls: string) => `<a class="${cls}" href="/" aria-label="Porthole home"><img src="/brand/mark.svg" alt="" width="44" height="44"><span>Porthole</span></a>`
