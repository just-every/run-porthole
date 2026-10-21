import type { RunData } from '../../base/run-site'

// Where the homepage's links go. Docs is the run site's /docs, built from the
// repository's Markdown; Source is the repository; Try the demo is the seed's
// demo host, as on the other seeds.
export interface Links { run: string; docs: string; source: string; demo: string; contract: string | null }

export const homeLinks = (run: RunData, contract: boolean): Links => ({
  run: '/run',
  docs: '/docs',
  source: run.repository,
  demo: 'https://demo.run-porthole.com/',
  contract: contract ? '/contract' : null,
})
