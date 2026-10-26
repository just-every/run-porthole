#!/usr/bin/env node
import {extractSplunk} from './splunk/extract.mjs'
import {ExtractionError} from './splunk/provider.mjs'

try {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/splunk-export.mjs --realm us0 --output <private-file> [--resume] [--slo-id <source-id> ...] [--metric-query <query> --start-ms <ms> --end-ms <ms> --resolution <ms>]\nSet SPLUNK_ACCESS_TOKEN in the environment. GET-only chart, dashboard and detector definitions, selected SLO details and optional bounded historical metrics with MTS metadata. Historical resolutions: 1000, 60000, 300000, 3600000. Repeat the identical selection on resume. SLO discovery and APM topology use separate authorized source exports; RUM configuration comes from application setup. Resume state: <private-file>.checkpoint.json. Completed exports cannot be overwritten.')
  } else {
    const options = {resume: false, sloIds: []}
    const fields = {'--realm': 'realm', '--output': 'output', '--metric-query': 'metricQuery', '--start-ms': 'startMs', '--end-ms': 'endMs', '--resolution': 'resolution'}
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--resume' && !options.resume) options.resume = true
      else if (arg === '--slo-id' && args[i + 1] && !args[i + 1].startsWith('--')) options.sloIds.push(args[++i])
      else if (fields[arg] && options[fields[arg]] === undefined && args[i + 1] && !args[i + 1].startsWith('--')) options[fields[arg]] = args[++i]
      else throw new ExtractionError('Invalid arguments. Use --help; credentials belong only in SPLUNK_ACCESS_TOKEN.')
    }
    await extractSplunk(options)
    console.log('Selected source export completed. Upload the private JSON file at /app/import. This export does not establish a complete account, transactional snapshot or execution parity. Historical rollups, unread periods, retention and paid entitlements remain explicit review work. APM topology, RUM setup, SLO discovery and platform log searches require their separate authorized exports.')
  }
} catch (error) {
  // Never interpolate provider errors, filesystem paths, arguments or response bodies.
  console.error(error instanceof ExtractionError ? error.message : 'Export incomplete: local state could not be read or written. Check the private destination and available space, then use --resume.')
  process.exitCode = error instanceof ExtractionError ? error.exitCode : 1
}
