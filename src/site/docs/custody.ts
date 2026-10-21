// Which of the seed's files are copies of Base files: base-copies.json records
// each copy's path in Base and the revision it was taken at, and edition.json
// the Base repository. A copied document's links to Base files the seed does
// not ship resolve there, or to the seed's own copy when it ships one.
import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

/** Where Base keeps a file the seed copied. */
export interface Origin { repository: string; revision: string; file: string }

export interface Custody {
  /** Base's original of the seed file `file`, or null when the seed did not copy it. */
  origin(file: string): Origin | null
  /** The seed's copy of Base's `file` at `revision`, when it ships one. */
  copy(file: string, revision: string): string | undefined
}

type Copies = { copies: { path: string; originPath: string; revision: string; files: Record<string, string> }[] }
type Edition = { components: { id: string; source: { origin?: { repository: string } } }[] }

export function readCustody(root: string): Custody {
  const { copies }: Copies = JSON.parse(readFileSync(join(root, 'base-copies.json'), 'utf8'))
  const edition: Edition = JSON.parse(readFileSync(join(root, 'edition.json'), 'utf8'))
  const repository = edition.components.find(component => component.id === 'runeditrun/base')?.source.origin?.repository.replace(/\.git$/, '')
  if (!repository) throw new Error('edition.json records no Base repository for the files base-copies.json lists.')
  const origins = new Map<string, Origin>(), seedFiles = new Map<string, string>()
  for (const copy of copies) for (const file of Object.keys(copy.files)) {
    const origin = { repository, revision: copy.revision, file: file === copy.path ? copy.originPath : posix.join(copy.originPath, posix.relative(copy.path, file)) }
    origins.set(file, origin)
    seedFiles.set(`${origin.revision}:${origin.file}`, file)
  }
  return { origin: file => origins.get(file) ?? null, copy: (file, revision) => seedFiles.get(`${revision}:${file}`) }
}
