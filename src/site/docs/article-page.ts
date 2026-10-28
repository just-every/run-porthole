// One document's article: the documentation menu (a sidebar on wide screens,
// "All docs" on narrow ones), the title with the document's source, its
// contents ("On this page"), the rendered Markdown and the previous and next
// documents.
import { escape } from '../../base/run-site'
import { groups, type Doc } from './catalog'
import { docsDocument, pathHtml, type Frame } from './frame'
import type { Body } from './markdown'
import { ARTICLE_SCRIPT } from './script'
import { NB, prose } from './text'

function menu(docs: Doc[], current: Doc): string {
  return '<a class="docs-nav-home" href="/docs">All documentation</a>' + groups.map(group => {
    const links = docs.filter(doc => doc.group === group).map(doc => `<a href="${doc.path}"${doc === current ? ' aria-current="page"' : ''}>${prose(doc.title)}</a>`).join('')
    if (!links) return ''
    return group === 'Technical reference'
      ? `<details class="docs-nav-group"${current.group === group ? ' open' : ''}><summary>${escape(group)}</summary>${links}</details>`
      : `<div class="docs-nav-group"><p>${escape(group)}</p>${links}</div>`
  }).join('')
}

export function articlePage(doc: Doc, body: Body, docs: Doc[], frame: Frame, repository: string): string {
  const nav = menu(docs, doc), at = docs.indexOf(doc), source = `${repository}/blob/main/${doc.file}`
  const contents = body.contents.map(heading => `<a href="#${escape(heading.id)}">${heading.html}</a>`).join('')
  const pager = ([[docs[at - 1], 'prev', 'Previous'], [docs[at + 1], 'next', 'Next']] as const)
    .map(([other, rel, label]) => other ? `<a class="card" rel="${rel}" href="${other.path}"><span>${label}</span><strong>${prose(other.title)}</strong></a>` : '').join('')
  const main = `<div class="docs-layout frame"><aside class="docs-side"><nav class="docs-nav" aria-label="Documentation">${nav}</nav></aside>`
    + `<main id="docs-main" class="docs-main"><details class="docs-menu"><summary>All docs</summary><nav class="docs-nav" aria-label="Documentation menu">${nav}</nav></details>`
    + `<article><header class="docs-title"><p class="eyebrow"><a href="/docs">Docs</a>${NB}·${NB}${escape(doc.group)}</p><h1>${prose(doc.title)}</h1>`
    + `${doc.version ? `<nav class="docs-version" aria-label="Documentation version"><strong>API v1</strong><a href="/docs/v1">All v1 guides</a><a href="${doc.alias}">Current (v1)</a></nav>` : ''}`
    + `${doc.summary ? `<p class="lead">${prose(doc.summary)}</p>` : ''}<p class="docs-source">Source: <a href="${escape(source)}"><code>${pathHtml(doc.file)}</code></a></p></header>`
    + `${contents ? `<details class="docs-contents-menu"><summary>On this page</summary><nav aria-label="On this page">${contents}</nav></details>` : ''}`
    + `<div class="docs-prose">${body.html}</div><nav class="docs-pager" aria-label="Previous and next">${pager}</nav></article></main>`
    + `<aside class="docs-contents">${contents ? `<nav aria-label="On this page"><p>On this page</p>${contents}</nav>` : ''}</aside></div>`
  return docsDocument(frame, { title: `${doc.title} · Porthole docs`, description: doc.summary ?? `${doc.title}: ${doc.file} in Porthole’s repository.`, current: 'true', main, script: ARTICLE_SCRIPT })
}
