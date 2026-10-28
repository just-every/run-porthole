// Where a link written in a document goes on the run site: another article
// (and its heading), a file or folder of Porthole's repository on GitHub, or,
// in a document copied from Base, a file the seed does not ship at that path:
// the seed's own copy of it when there is one, else Base's file at the
// recorded revision. Anything else stops the build, naming the document and
// the link.
import { existsSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import type { Doc } from './catalog'
import type { Custody } from './custody'
import type { Body } from './markdown'

export function linkResolver(root: string, docs: Doc[], custody: Custody, repository: string) {
  const byFile = new Map(docs.map(doc => [doc.file, doc]))
  return (doc: Doc, href: string): string => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href
    const hash = href.indexOf('#'), target = decodeURIComponent(hash < 0 ? href : href.slice(0, hash)), fragment = hash < 0 ? '' : href.slice(hash)
    const file = posix.normalize(posix.join(posix.dirname(doc.file), target)).replace(/\/$/, '')
    // A file of this repository: its article, or its page on GitHub.
    const seedFile = (path: string) => byFile.get(path)?.path ?? `${repository}/${statSync(join(root, path)).isDirectory() ? 'tree' : 'blob'}/main/${path}`
    if (byFile.has(file) || (!file.startsWith('../') && existsSync(join(root, file)))) return seedFile(file) + fragment
    if (doc.origin) {
      const origin = posix.normalize(posix.join(posix.dirname(doc.origin.file), target)), copy = custody.copy(origin, doc.origin.revision)
      if (copy) return seedFile(copy) + fragment
      if (!origin.startsWith('../')) return `${doc.origin.repository}/blob/${doc.origin.revision}/${origin}${fragment}`
    }
    throw new Error(`${doc.file} links to ${href}, which is not a file in this repository${doc.origin ? ' or at its Base origin' : ''}.`)
  }
}

/** Every link to an article, or to a heading on one, names a page and heading the docs have. */
export function checkDocLinks(docs: Doc[], bodies: Map<string, Body>, root: string): void {
  const problems: string[] = []
  for (const doc of docs) for (const href of bodies.get(doc.path)!.links) {
    if (!href.startsWith('#') && !href.startsWith('/docs/')) continue
    const hash = href.indexOf('#'), path = hash === 0 ? doc.path : hash < 0 ? href : href.slice(0, hash)
    const anchor = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1)), target = bodies.get(path) ?? bodies.get(docs.find(doc => doc.alias === path)?.path ?? '')
    if (!anchor && path === '/docs/v1') continue
    if (!anchor && path.startsWith('/docs/examples/') && !path.includes('..') && existsSync(join(root, 'public', path))) continue
    if (!target || (anchor && !target.ids.has(anchor))) problems.push(`${doc.file}: ${href}`)
  }
  if (problems.length) throw new Error(`Docs links that lead nowhere:\n${problems.join('\n')}`)
}
