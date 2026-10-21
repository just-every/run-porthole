import type { Links } from './links'
import { lockup } from './parts'

const nav = (links: Links, label: string) => `<nav aria-label="${label}"><a href="${links.docs}">Docs</a>${links.contract ? `<a href="${links.contract}">Contract</a>` : ''}<a href="${links.source}">Source</a></nav>`

export const siteHeader = (links: Links) => `<header class="site-header">${lockup('lockup')}${nav(links, 'Site')}</header>`

export const siteFooter = (links: Links) => `<footer class="site-footer"><div class="frame foot">${lockup('lockup lockup-small')}`
  + `<p class="foot-line">Free, open source observability</p>${nav(links, 'Footer')}</div></footer>`
