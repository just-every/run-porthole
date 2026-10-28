// Regenerate touched legacy clause journeys without rewriting ct's contract.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {parseContract} from '../../src/base/seed-contract.mjs'
const [mode,...ids]=process.argv.slice(2)
if(!['write','check'].includes(mode)||!ids.length)throw Error('Usage: node scripts/porthole/contract-docs.mjs write|check CLAUSE...')
const source=await readFile('CONTRACT.md','utf8'),lines=source.split('\n')
const cells=line=>line.trim().slice(1,-1).split(/(?<!\\)\|/).map(cell=>cell.trim())
const rows=lines.filter(line=>/^\| `[^`]+` \|/.test(line)).map(cells)
const tally=items=>['done','partial','missing'].map(status=>items.filter(row=>row[3]===status).length).concat(items.length)
const summary=lines.findIndex(line=>line.startsWith('| Clauses | Done |'))
if(summary<0)throw Error('Missing contract status summary')
for(const [offset,label,items] of [[2,'Published',rows.filter(row=>row[2]==='published')],[3,'Target and push further',rows.filter(row=>row[2]!=='published')],[4,'All',rows]])lines[summary+offset]=`| ${label} | ${tally(items).join(' | ')} |`
const contract=lines.join('\n'),parsed=parseContract(contract),byId=new Map(parsed.clauses.map(clause=>[clause.id,clause]))
let acceptance=await readFile('ACCEPTANCE.md','utf8')
for(const id of ids) {
 const clause=byId.get(id)
 if(!clause)throw Error('Unknown clause '+id)
 const points=clause.text.split('**Acceptance evidence:**')[1]?.trim()
 if(!points)throw Error(id+' has no legacy acceptance evidence')
 const row=cells(lines[clause.row-1]),evidence=row[4],gap=row[5]
 const journey=`- **${id} — ${clause.title}. Status: ${clause.status}.** ${points}${evidence?' Evidence: '+evidence:''}${gap&&gap!=='—'?' Open scope: '+gap:''}`
 const paragraphs=acceptance.split('\n\n'),index=paragraphs.findIndex(paragraph=>paragraph.startsWith(`- **${id} — `))
 if(index<0)throw Error('Missing generated journey '+id)
 paragraphs[index]=journey;acceptance=paragraphs.join('\n\n')
}
acceptance=acceptance.replace(/\d+ are \*\*done\*\*, \d+ are \*\*partial\*\* and \d+ are \*\*missing\*\*/,`${parsed.counts.done} are **done**, ${parsed.counts.partial} are **partial** and ${parsed.counts.missing} are **missing**`)
const claims=['<!-- Generated from CONTRACT.md by scripts/porthole/contract-docs.mjs. -->','# Porthole product status',
 'These are contract statuses, not a claim that a partial or missing capability is complete. Read the [product contract](/docs/contract) for requirements, named journeys and remaining work.',
 `${parsed.counts.done} done, ${parsed.counts.partial} partial, ${parsed.counts.missing} missing; ${parsed.counts.total} total.`,
 ['| Clause | Capability | Status |','| --- | --- | --- |',...parsed.clauses.map(clause=>`| ${clause.id} | ${clause.title} | ${clause.status} |`)].join('\n'),''].join('\n\n')
for(const [file,text] of [['CONTRACT.md',contract],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]) {
 let current
 try {current=await readFile(file,'utf8')} catch(error){if(error.code!=='ENOENT')throw error}
 if(current===text)continue
 if(mode==='check')throw Error(file+' is stale; regenerate the touched clauses')
 await mkdir(file.includes('/')?file.slice(0,file.lastIndexOf('/')):'.',{recursive:true});await writeFile(file,text)
}
console.log('Contract documents are current for '+ids.join(', '))
