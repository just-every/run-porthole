import type { RunData } from '../../base/run-site'

// Where the homepage's links go. The run site has no /docs yet (run.json
// "docs": false), so Docs opens the repository's run guide; Source is the
// repository; Try the demo is the seed's demo host, as on the other seeds.
export interface Links { run: string; docs: string; source: string; demo: string; contract: string | null }

export const homeLinks = (run: RunData, contract: boolean): Links => ({
  run: '/run',
  docs: run.docs ? '/docs' : `${run.repository}/blob/main/RUN-LOCALLY.md`,
  source: run.repository,
  demo: 'https://demo.run-porthole.com/',
  contract: contract ? '/contract' : null,
})
