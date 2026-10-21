#!/usr/bin/env node
// Independent offline reader: it intentionally imports no application code.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export function verifyAudit(packet, trustedHash) {
 if (!/^[a-f0-9]{64}$/.test(trustedHash ?? '') || packet?.format !== 'porthole.audit.v1' || !Array.isArray(packet.records)) throw Error('Invalid export or independently retained checkpoint')
 let sequence = 0, previousHash = '0'.repeat(64)
 const ids = new Set()
 for (const record of packet.records) {
  const entry = record.entry
  if (entry.version !== 1 || entry.sequence !== ++sequence || entry.previousHash !== previousHash || ids.has(entry.eventId)) throw Error('Audit order or continuity failed')
  ids.add(entry.eventId)
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))))
  const hash = createHash('sha256').update(canonical).digest('hex')
  if (record.hash !== hash) throw Error('Audit digest failed')
  previousHash = hash
 }
 if (packet.checkpoint.sequence !== sequence || packet.checkpoint.hash !== previousHash || previousHash !== trustedHash || packet.next !== null || packet.range.after !== 0 || packet.range.through !== sequence) throw Error('Audit checkpoint or completeness failed')
 return sequence
}
if (process.argv[1] === import.meta.filename) {
 try {
  const [file, hash, extra] = process.argv.slice(2)
  if (!file || !hash || extra) throw Error('Usage: node scripts/porthole/verify-audit.mjs EXPORT CHECKPOINT_HASH')
  console.log(`Verified ${verifyAudit(JSON.parse(await readFile(file, 'utf8')), hash)} audit entries`)
 } catch (error) { console.error(error.message); process.exitCode = 1 }
}
