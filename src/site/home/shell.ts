import type { Links } from './links'
import { lockup } from './parts'

// The docs pages mark Docs current: the page itself at /docs, its section on an article.
export type Current = 'page' | 'true'

const nav = (links: Links, label: string, current?: Current) => `<nav aria-label="${label}"><a href="${links.docs}"${current ? ` aria-current="${current}"` : ''}>Docs</a>${links.contract ? `<a href="${links.contract}">Contract</a>` : ''}<a href="${links.source}">Source</a></nav>`

export const siteHeader = (links: Links, current?: Current) => `<header class="site-header">${lockup('lockup')}${nav(links, 'Site', current)}</header>`

export const siteFooter = (links: Links) => `<footer class="site-footer"><div class="frame foot">${lockup('lockup lockup-small')}`
  + `<p class="foot-line">Free, open source observability</p>${nav(links, 'Footer')}</div></footer>`
