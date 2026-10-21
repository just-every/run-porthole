// One document's Markdown as article HTML, GitHub-flavoured as the repository
// shows it: headings carry GitHub's anchors and the h2s make the page's
// contents, code blocks get their language and a Copy button, inline code
// keeps its words whole, table cells carry their column's name for narrow
// screens, raw HTML shows as the text it is, and every link goes where
// `resolve` sends it.
import { Marked } from 'marked'
import { escape } from '../../base/run-site'
import { prose } from './text'

export interface Heading { id: string; html: string }
export interface Body { html: string; contents: Heading[]; ids: Set<string>; links: string[] }

const languages: Record<string, string> = { sh: 'Shell', bash: 'Shell', text: 'Text', ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', json: 'JSON' }
const copyIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="2"/><path d="M3 10.5V4a1.5 1.5 0 0 1 1.5-1.5H10"/></svg>'
// GitHub's heading anchors: lower case, punctuation other than "-" and "_" dropped, each space a hyphen.
const anchor = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-')
// Code wraps only at its own spaces, as the Run page's does, keeping each word
// of up to 30 characters whole; a longer word may also break after a slash or
// punctuation, and anywhere as a last resort.
const codeWords = (text: string) => text.split(/(\s+)/).map((part, i) => i % 2 || !part ? part
  : part.length <= 30 ? `<span class="docs-word">${escape(part)}</span>` : part.split(/(?<=[/,;|}\]])(?!\/)/).map(escape).join('<wbr>')).join('')
const inlineCode = (text: string) => `<code>${codeWords(text)}</code>`

// Each source line of a code block is a block of its own, so a line too long
// for the column wraps under a hanging indent, two characters past its own
// indentation, instead of passing for a new line. An empty line holds its
// newline, which keeps it in a copied selection.
const codeLines = (text: string) => text.split('\n').map(line => {
  const indent = line.match(/^[ \t]*/)![0].replace(/\t/g, '  ').length
  return `<span class="docs-line"${indent ? ` style="--indent:${indent}"` : ''}>${line ? codeWords(line) : '\n'}</span>`
}).join('')

export function renderMarkdown(markdown: string, resolve: (href: string) => string): Body {
  const contents: Heading[] = [], ids = new Set<string>(), links: string[] = []
  let titled = false
  const marked = new Marked({ gfm: true, renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens, this.parser.textRenderer), base = anchor(text)
      let id = base
      for (let n = 1; ids.has(id); n++) id = `${base}-${n}`
      ids.add(id)
      // The document's title is the article's own h1; its anchor stays.
      if (depth === 1 && !titled) { titled = true; return `<div id="${escape(id)}"></div>\n` }
      const level = Math.max(depth, 2)
      if (level === 2) contents.push({ id, html: prose(text) })
      return `<h${level} id="${escape(id)}">${this.parser.parseInline(tokens)}</h${level}>\n`
    },
    text(token) {
      if ('tokens' in token && token.tokens) return this.parser.parseInline(token.tokens)
      return 'escaped' in token && token.escaped ? token.text : prose(token.text)
    },
    codespan({ text }) { return inlineCode(text) },
    code({ text, lang }) {
      const language = (lang ?? '').split(/\s/)[0]
      const label = languages[language] ?? (language ? language.toUpperCase() : 'Text')
      return `<div class="docs-code"><div class="docs-code-head"><span>${escape(label)}</span><button class="docs-copy" type="button" data-copy="${escape(text)}">${copyIcon}<span>Copy</span></button></div>`
        + `<pre><code>${codeLines(text)}</code></pre></div>\n`
    },
    html({ text, block }) { return block ? `<p>${prose(text.trim())}</p>\n` : prose(text) },
    link({ href, title, tokens }) {
      const target = resolve(href)
      links.push(target)
      return `<a href="${escape(target)}"${title ? ` title="${escape(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`
    },
    table({ header, rows }) {
      const names = header.map(cell => prose(this.parser.parseInline(cell.tokens, this.parser.textRenderer)))
      const classes = (...list: (string | false | null)[]) => list.some(Boolean) ? ` class="${list.filter(Boolean).join(' ')}"` : ''
      const head = names.some(Boolean) ? `<thead><tr>${header.map(cell => `<th scope="col"${classes(cell.align && `docs-${cell.align}`)}>${this.parser.parseInline(cell.tokens)}</th>`).join('')}</tr></thead>` : ''
      // An empty cell keeps its column in a table and is left out of a stacked row.
      const body = rows.map(row => `<tr>${row.map((cell, i) => `<td${classes(cell.align && `docs-${cell.align}`, !cell.text.trim() && 'docs-empty')}>${names[i] ? `<span class="docs-cell-label">${names[i]}</span>` : ''}${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`).join('')
      return `<div class="docs-table docs-cols-${Math.min(header.length, 4)}"><table>${head}<tbody>${body}</tbody></table></div>\n`
    },
  } })
  return { html: marked.parse(markdown, { async: false }), contents, ids, links }
}
