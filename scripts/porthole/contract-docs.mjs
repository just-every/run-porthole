import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {parseContract} from '../../src/base/seed-contract.mjs'

// Preserve the legacy contract and untouched journey notes until ct's rewrite.
const [mode,...ids]=process.argv.slice(2)
if(!['write','check'].includes(mode)||!ids.length||ids.some(id=>!/^PORT-\d{3}$/.test(id)))throw Error('Usage: contract-docs.mjs write|check PORT-010 PORT-078')
const original=await readFile('CONTRACT.md','utf8'),lines=original.split('\n')
const cells=line=>line.split(/(?<!\\)\|/).slice(1,-1).map(v=>v.trim())
const rows=lines.filter(line=>/^\| `PORT-\d{3}` \|/.test(line)).map(cells)
const tally=selected=>['done','partial','missing'].map(state=>selected.filter(row=>row[3]===state).length).concat(selected.length)
const summary={Published:tally(rows.filter(row=>row[2]==='published')),'Target and push further':tally(rows.filter(row=>row[2]!=='published')),All:tally(rows)}
const contract=lines.map(line=>{const label=cells(line)[0];return Object.hasOwn(summary,label)?`| ${label} | ${summary[label].join(' | ')} |`:line}).join('\n')
const parsed=parseContract(contract)
for(const id of ids)if(!parsed.clauses.some(c=>c.id===id))throw Error('Unknown clause '+id)
const acceptance=await readFile('ACCEPTANCE.md','utf8')
const entries=new Map(rows.map(row=>[row[0].replaceAll('`',''),row]))
const generated=acceptance.split('\n').map(line=>{
 const id=/^- \*\*(PORT-\d{3}) /.exec(line)?.[1]
 if(!ids.includes(id))return line
 const clause=parsed.clauses.find(c=>c.id===id),row=entries.get(id),journey=clause.text.split('**Acceptance evidence:**')[1]?.trim()
 if(!journey)throw Error('Legacy acceptance missing for '+id)
 return `- **${id} — ${clause.title}. Status: ${clause.status}.** ${journey}${row[4]?` Evidence: ${row[4]}`:''}${clause.status==='done'?'':` Gap: ${row[5]}`}`
}).join('\n').replace(/\d+ are \*\*done\*\*, \d+ are \*\*partial\*\* and \d+ are \*\*missing\*\*/,`${parsed.counts.done} are **done**, ${parsed.counts.partial} are **partial** and ${parsed.counts.missing} are **missing**`)
const claimStart=lines.findIndex(line=>/^## .*Homepage claims/i.test(line))
const claimEnd=lines.findIndex((line,i)=>i>claimStart&&line.startsWith('## '))
const claims=lines.slice(claimStart,claimEnd<0?lines.length:claimEnd).filter(line=>line.startsWith('| ')).map(cells).filter(row=>row.length===4&&!row[0].startsWith('-')&&row[0]!=='Claim')
const count={done:0,partial:0,missing:0}
const claimRows=claims.map(([claim,section,refs],i)=>{
 const linked=[...refs.matchAll(/PORT-\d{3}/g)].map(m=>parsed.clauses.find(c=>c.id===m[0]))
 if(linked.some(c=>!c))throw Error('Unresolved homepage claim')
 const status=linked.length?(linked.every(c=>c.status==='done')?'done':linked.every(c=>c.status==='missing')?'missing':'partial'):'done'
 count[status]++
 return `| ${i+1} | ${claim} | ${section} | ${linked.map(c=>`\`${c.id}\` ${c.status}`).join('; ')||'—'} | ${status} |`
})
const claimDoc='<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->\n\n# Porthole homepage claims\n\nA claim is done when every clause behind it is done, missing when every one is missing, and partial otherwise.\n\n| # | Claim | Section | Clauses | Status |\n| --- | --- | --- | --- | --- |\n'+claimRows.join('\n')+`\n\nClaims: ${claims.length}; ${count.done} done, ${count.partial} partial, ${count.missing} missing.\n`
for(const [path,value] of [['CONTRACT.md',contract],['ACCEPTANCE.md',generated],['docs/CLAIMS.md',claimDoc]]){
 if(mode==='write'){await mkdir('docs',{recursive:true});await writeFile(path,value)}
 else if(await readFile(path,'utf8')!==value)throw Error('Stale generated view: '+path)
}
console.log('Contract summaries and touched journeys agree: '+ids.join(', '))
