// The run site's documentation: /docs and one article per repository Markdown
// document (catalog.ts), rendered when `rer build --site` runs the site entry
// from the checkout root, in the homepage's header, footer, tokens and type.
// A link that leads nowhere stops the build.
import type { RunData } from '../../base/run-site'
import type { SeedContract } from '../../base/seed-contract.mjs'
import { homeLinks } from '../home/links'
import { articlePage } from './article-page'
import { readDocs } from './catalog'
import { readCustody } from './custody'
import { indexPage } from './index-page'
import { checkDocLinks, linkResolver } from './links'
import { renderMarkdown } from './markdown'

export function docsPages(run: RunData, styles: string[], contract: SeedContract | undefined): { path: string; html: string }[] {
  const root = process.cwd(), custody = readCustody(root), docs = readDocs(root, custody), resolve = linkResolver(root, docs, custody, run.repository)
  const bodies = new Map(docs.map(doc => [doc.path, renderMarkdown(doc.markdown, href => resolve(doc, href))]))
  checkDocLinks(docs, bodies, root)
  const frame = { styles, links: homeLinks(run, !!contract) }
  return [
    { path: '/docs', html: indexPage(docs, frame, contract) },
    { path: '/docs/v1', html: indexPage(docs.filter(doc => doc.version === 'v1'), frame, contract, 'v1') },
    ...docs.flatMap(doc => {
      const html = articlePage(doc, bodies.get(doc.path)!, docs, frame, run.repository)
      return [{ path: doc.path, html }, ...(doc.alias ? [{ path: doc.alias, html }] : [])]
    }),
  ]
}
