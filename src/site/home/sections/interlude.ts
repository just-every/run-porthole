import { check, plate } from '../parts'

// 06, the interlude: a dark street of row houses at 3:07 am, every window dark,
// fading to white top and foot, and one set-type tag.
export const interlude = (): string => '<section class="interlude" aria-label="Tue Oct 20, 3:07 am">'
  + plate({ name: 'street', widths: [768, 1152, 1536, 2304, 3072], sizes: 'min(100vw, 1536px)', alt: 'A residential street of brick row houses and a low apartment block at 3:07 am: every window dark, one streetlight, three cars parked at the curb and a cat on a stoop.', cls: 'street', width: 1536, height: 905 })
  + `<p class="street-tag">Tue Oct 20 · 3:07 am · search-indexer killed · search kept serving · nobody paged${check}</p></section>`
