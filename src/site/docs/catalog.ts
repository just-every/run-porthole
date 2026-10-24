// The documents the run site publishes under /docs: every Markdown file at the
// repository root and under src and public, read from the checkout that
// `rer build --site` runs the site entry in. The root guides carry a short
// title, a group and a written summary; every other document keeps its own
// heading and is listed under Technical reference by its path.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Lexer, type Tokens } from 'marked'
import type { Custody, Origin } from './custody'

export const groups = ['Start here', 'Operate & develop', 'Product & design', 'Technical reference'] as const
export type Group = typeof groups[number]

export interface Doc {
  /** Its repository path: "RUN-LOCALLY.md". */
  file: string
  /** Its site path: "/docs/run-locally". */
  path: string
  title: string
  /** A root guide's written summary; other documents are listed by their path. */
  summary: string | null
  group: Group
  markdown: string
  /** Set for a document copied from Base, whose links to Base files the seed leaves out resolve there. */
  origin: Origin | null
}

type Guide = { slug: string; title: string; group: Group; summary: string }
// The root guides, in reading order.
const guides: Record<string, Guide> = {
  'README.md': { slug: 'getting-started', title: 'Getting started', group: 'Start here', summary: 'What this repository holds today, the one line that starts Porthole on your computer and the versions it pins.' },
  'RUN-LOCALLY.md': { slug: 'run-locally', title: 'Run it locally', group: 'Start here', summary: 'Start a copy with one command, install for a real owner, back up and restore an installation, and recover a hosted deployment.' },
  'ONBOARDING.md': { slug: 'setup', title: 'Setup', group: 'Start here', summary: 'How rer setup works on this foundation: the setup manifest and adapter, the owner’s inputs and the lifecycle’s safety rules.' },
  'OPERATIONS.md': { slug: 'operations', title: 'Operations', group: 'Operate & develop', summary: 'Everyday commands, local data and recovery, installation archives and owner-account deployment.' },
  'SEED-COMMAND-CONTRACT.md': { slug: 'commands', title: 'Command reference', group: 'Operate & develop', summary: 'The public command contract: verbs and flags, output and exits, local sign-in and state, the run site and pins.' },
  'VERIFY-WORKFLOW.md': { slug: 'verification', title: 'Verification', group: 'Operate & develop', summary: 'How Verify and Nightly journeys plan their shards from verification.json, and how edition source locks are checked.' },
  'CONTRACT.md': { slug: 'contract', title: 'Product contract', group: 'Product & design', summary: 'The observability product Porthole is being built toward: its target clauses, honest boundaries, homepage claims and every clause’s status.' },
  'ACCEPTANCE.md': { slug: 'acceptance', title: 'Acceptance requirements', group: 'Product & design', summary: 'The journey each contract clause must pass, with its desk, inventory and integration coverage.' },
  'HOMEPAGE-VARIANTS.md': { slug: 'homepage-variants', title: 'Two homepages', group: 'Product & design', summary: 'Why every seed has a run site and an installed Lobby, and the identity, rules and site entry that adopt both.' },
}
const order = Object.keys(guides)

// Markdown files directly in `directory`, or at any depth below it; never in node_modules or hidden folders.
function markdownFiles(root: string, directory: string, deep: boolean): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = directory ? `${directory}/${entry.name}` : entry.name
    if (entry.isDirectory()) return deep && !entry.name.startsWith('.') && entry.name !== 'node_modules' ? markdownFiles(root, file, true) : []
    return entry.isFile() && entry.name.endsWith('.md') ? [file] : []
  })
}

// The document's own first-level heading as plain text.
const heading = (markdown: string) => {
  const token = Lexer.lex(markdown, { gfm: true }).find((token): token is Tokens.Heading => token.type === 'heading' && token.depth === 1)
  return token?.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim()
}
// "src/modules/mail/README.md" -> "src/modules/mail/readme".
const slugOf = (file: string) => file.replace(/\.md$/, '').toLowerCase().replace(/[^a-z0-9/]+/g, '-').replace(/^-|-$/g, '')

export function readDocs(root: string, custody: Custody): Doc[] {
  const docs = [...markdownFiles(root, '', false), ...markdownFiles(root, 'src', true), ...markdownFiles(root, 'public', true)].map((file): Doc => {
    const markdown = readFileSync(join(root, file), 'utf8'), guide = guides[file]
    return {
      file, markdown,
      path: `/docs/${guide?.slug ?? slugOf(file)}`,
      title: guide?.title ?? heading(markdown) ?? file,
      summary: guide?.summary ?? null,
      group: guide?.group ?? 'Technical reference',
      origin: custody.origin(file),
    }
  })
  const rank = (doc: Doc) => order.includes(doc.file) ? order.indexOf(doc.file) : order.length
  docs.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || rank(a) - rank(b) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  const seen = new Set<string>()
  for (const doc of docs) {
    if (seen.has(doc.path)) throw new Error(`Two documents publish at ${doc.path}; rename one of them.`)
    seen.add(doc.path)
  }
  return docs
}
