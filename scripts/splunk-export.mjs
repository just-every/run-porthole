#!/usr/bin/env node
import {extractSplunk} from './splunk/extract.mjs'
import {ExtractionError} from './splunk/provider.mjs'

try {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/splunk-export.mjs --realm us0 --output <private-file> [--resume]\nSet SPLUNK_ACCESS_TOKEN in the environment. GET-only chart, dashboard and detector definitions; no telemetry history. Resume state: <private-file>.checkpoint.json. Completed exports cannot be overwritten.')
  } else {
    const options = {resume: false}
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--resume' && !options.resume) options.resume = true
      else if ((arg === '--realm' || arg === '--output') && !options[arg.slice(2)] && args[i + 1] && !args[i + 1].startsWith('--')) options[arg.slice(2)] = args[++i]
      else throw new ExtractionError('Invalid arguments. Use --help; credentials belong only in SPLUNK_ACCESS_TOKEN.')
    }
    await extractSplunk(options)
    console.log('Definition export completed. Upload the private JSON file at /app/import. This paginated export does not establish a transactional snapshot or execution parity.')
  }
} catch (error) {
  // Never interpolate provider errors, filesystem paths, arguments or response bodies.
  console.error(error instanceof ExtractionError ? error.message : 'Export incomplete: local state could not be read or written. Check the private destination and available space, then use --resume.')
  process.exitCode = error instanceof ExtractionError ? error.exitCode : 1
}
