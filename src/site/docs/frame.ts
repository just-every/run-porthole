// The docs pages' document: the homepage's head (icons, the preloaded text
// face and the site stylesheet) with /docs.css after it, its header with Docs
// marked current, and its footer.
import { escape } from '../../base/run-site'
import { iconHead } from '../../base/icon-head'
import type { Links } from '../home/links'
import { siteFooter, siteHeader, type Current } from '../home/shell'

export interface Frame { styles: string[]; links: Links }
export interface Page { title: string; description: string; current: Current; main: string; copy?: boolean }

// The code blocks' Copy buttons, which work as the Run page's do.
const COPY_SCRIPT = "document.addEventListener('click',async event=>{const button=event.target.closest('.docs-copy');if(!button)return;try{await navigator.clipboard.writeText(button.dataset.copy);const label=button.querySelector('span');label.textContent='Copied';setTimeout(()=>{label.textContent='Copy'},1600)}catch{}})"

/** A repository path that may break after each slash. */
export const pathHtml = (file: string) => escape(file).replaceAll('/', '/<wbr>')
export const arrow = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h12.5M11 5l5 5-5 5"/></svg>'

export function docsDocument({ styles, links }: Frame, { title, description, current, main, copy = false }: Page): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="theme-color" content="#ffffff">${iconHead}`
    + '<link rel="preload" href="/fonts/porthole/inter-var.woff2" as="font" type="font/woff2" crossorigin>'
    + [...styles, '/docs.css'].map(href => `<link rel="stylesheet" href="${escape(href)}">`).join('')
    + `</head><body class="docs"><a class="docs-skip" href="#docs-main">Skip to content</a><div class="docs-top">${siteHeader(links, current)}</div>`
    + `${main}${siteFooter(links)}${copy ? `<script>${COPY_SCRIPT}</script>` : ''}</body></html>`
}
