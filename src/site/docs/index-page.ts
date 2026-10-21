// /docs: the homepage's section head over every document, the root guides as
// cards in their groups and the rest listed by path under Technical reference.
import { escape } from '../../base/run-site'
import type { SeedContract } from '../../base/seed-contract.mjs'
import { groups, type Doc } from './catalog'
import { arrow, docsDocument, pathHtml, type Frame } from './frame'
import { NB, prose } from './text'

// The judged date is a calendar day, as the contract page prints it.
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const card = (doc: Doc) => `<li><a class="card docs-card" href="${doc.path}"><h3>${prose(doc.title)}</h3><p>${prose(doc.summary ?? doc.file)}</p><span class="docs-go">Read${arrow}</span></a></li>`
const row = (doc: Doc) => `<li><a href="${doc.path}"><strong>${prose(doc.title)}</strong><code>${pathHtml(doc.file)}</code></a></li>`

export function indexPage(docs: Doc[], frame: Frame, contract: SeedContract | undefined): string {
  const status = contract ? `<p class="docs-status">${prose(`${contract.counts.done} of ${contract.counts.total} contract clauses done · judged ${dateFormat.format(new Date(`${contract.date}T00:00:00Z`))}`)}${NB}·${NB}<a href="/contract">See the contract</a></p>` : ''
  const sections = groups.map((group, i) => {
    const members = docs.filter(doc => doc.group === group)
    if (!members.length) return ''
    const list = group === 'Technical reference' ? `<ul class="docs-files">${members.map(row).join('')}</ul>` : `<ul class="docs-cards">${members.map(card).join('')}</ul>`
    return `<section class="docs-group" aria-labelledby="docs-group-${i + 1}"><header class="docs-group-head"><span>${String(i + 1).padStart(2, '0')}</span><h2 id="docs-group-${i + 1}">${escape(group)}</h2></header>${list}</section>`
  }).join('')
  const main = '<main id="docs-main" class="docs-index frame"><header class="docs-intro"><p class="eyebrow">Porthole documentation</p>'
    + `<h1><span class="l1">Porthole’s docs.</span> <span class="l2">Written with the${NB}code.</span></h1>`
    + `<p class="lead">${prose('Every page here is a Markdown document from Porthole’s repository, rendered when this site is built: how to run Porthole on your computer, set it up and operate it, and the contract its observability product is being built to.')}</p>`
    + `<div class="hero-actions"><a class="pill" href="/run">Run Porthole${arrow}</a><a class="text-link" href="${docs[0].path}">${prose(docs[0].title)}</a></div>${status}</header>`
    + `<div class="docs-groups">${sections}</div></main>`
  return docsDocument(frame, { title: 'Docs · Porthole', description: 'Porthole’s documentation, rendered from the Markdown in its repository.', current: 'page', main })
}
