import type { Links } from '../links'
import { check, plate } from '../parts'

// 11, the closing: a crowded indoor arcade on Black Friday, Fri Nov 27 at
// 4:00 pm, fading to white, three cards over its foot, the promise and the
// two actions.
const arrow = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h12.5M11 5l5 5-5 5"/></svg>'
export const closing = (links: Links): string => '<section class="closing" aria-labelledby="closing-title">'
  + plate({ name: 'arcade', widths: [768, 1152, 1536, 2304, 3072], sizes: 'min(100vw, 1536px)', alt: 'A crowded indoor shopping arcade on Black Friday afternoon: two levels of shop fronts under a glass barrel-vault roof, garlands on the balcony and shoppers carrying bags and wrapped parcels.', cls: 'arcade', width: 1536, height: 900 })
  + `<ul class="close-cards"><li class="card"><span>Fri Nov 27 · 318,406 checkouts by 4:00 pm</span><span>p95 430 ms${check}</span></li><li class="card"><span>46 of 46 services traced</span><span>0 pages</span></li><li class="card"><span>every log line in your own bucket${check}</span></li></ul>`
  + '<div class="close-copy"><h2 id="closing-title"><span class="l1">The busiest day.</span> <span class="l2">Every service in view.</span></h2><p class="close-free">100% free and open source. MIT licensed.</p>'
  + `<div class="hero-actions"><a class="pill" href="${links.run}">Run Porthole${arrow}</a><a class="text-link" href="${links.docs}">Read the docs</a></div></div></section>`
