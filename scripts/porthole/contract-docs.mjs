import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {parseContract} from '../../src/base/seed-contract.mjs'

// Preserve the legacy contract until ct's judged conversion. This adapter only
// refreshes selected journey status, evidence and gaps, plus derived counts.
const [command,flag,list]=process.argv.slice(2)
if(!['write','check'].includes(command)||flag!=='--clauses'||!list)throw Error('Use write or check --clauses followed by comma-separated clause IDs.')
const selected=list.split(','),read=path=>readFileSync(path,'utf8')
let source=read('CONTRACT.md')
const lines=source.split('\n'),summary=lines.findIndex(line=>line.startsWith('| Clauses | Done |'))
if(summary<0)throw Error('Missing contract summary')
let end=summary+2;while(lines[end]?.startsWith('|'))end++
const contract=parseContract([...lines.slice(0,summary),...lines.slice(end)].join('\n'))
const tally=clauses=>['done','partial','missing'].map(status=>clauses.filter(clause=>clause.status===status).length).concat(clauses.length)
const groups=[['Published',contract.clauses.filter(clause=>clause.kind==='published')],['Target and push further',contract.clauses.filter(clause=>clause.kind!=='published')],['All',contract.clauses]]
lines.splice(summary+2,end-summary-2,...groups.map(([label,clauses])=>`| ${label} | ${tally(clauses).join(' | ')} |`))
source=lines.join('\n')
let acceptance=read('ACCEPTANCE.md')
const [done,partial,missing,total]=tally(contract.clauses)
acceptance=acceptance.replace(/All \*\*\d+\*\* clauses comprise \*\*\d+\*\* target and \d+ push-further/,`All **${total}** clauses comprise **${contract.clauses.filter(clause=>clause.kind==='target').length}** target and ${contract.clauses.filter(clause=>clause.kind!=='target').length} push-further`)
acceptance=acceptance.replace(/\d+ are \*\*done\*\*, \d+ are \*\*partial\*\* and \d+ are \*\*missing\*\*/,`${done} are **done**, ${partial} are **partial** and ${missing} are **missing**`)
for(const id of selected){
 const clause=contract.clauses.find(clause=>clause.id===id)
 if(!clause)throw Error('Unknown clause: '+id)
 const definition=source.split('\n').find(line=>line.startsWith('**'+id+' — '))
 if(!definition?.includes('**Acceptance evidence:** '))throw Error('Selected clause needs its existing acceptance evidence: '+id)
 const outcome=definition.split('**Acceptance evidence:** ')[1]
 const cells=source.split('\n').find(line=>line.startsWith('| `'+id+'` |')).split(/(?<!\\)\|/).map(cell=>cell.trim())
 const rows=acceptance.split('\n');let index=rows.findIndex(line=>line.startsWith('- **'+id+' — '))
 if(index<0){
  const following=contract.clauses.slice(contract.clauses.indexOf(clause)+1).map(next=>rows.findIndex(line=>line.startsWith('- **'+next.id+' — '))).find(position=>position>=0)
  index=following??rows.length;rows.splice(index,0,'','')
 }
 rows[index]=`- **${id} — ${clause.title}. Status: ${clause.status}.** ${outcome}${cells[5]?` Evidence: ${cells[5]}`:''}${cells[6]&&cells[6]!=='—'?` Open scope: ${cells[6]}`:''}`
 acceptance=rows.join('\n')
}
const claims=source.split('## Homepage claims\n')[1]?.split('\n## Status')[0].split('\n').filter(line=>line.startsWith('| ')&&!line.startsWith('| ---')&&!line.startsWith('| Claim |'))??[]
const claimRows=claims.map(line=>{
 const cells=line.split(/(?<!\\)\|/).map(cell=>cell.trim()),ids=cells[3].match(/PORT-\d{3}/g)??[]
 if(!ids.length)return `| ${cells[1]} | ${cells[2]} | ${cells[3]} | ${cells[4]} |`
 const linked=ids.map(id=>{const clause=contract.clauses.find(clause=>clause.id===id);if(!clause)throw Error('Unknown claim clause: '+id);return clause})
 const status=linked.every(clause=>clause.status==='done')?'done':linked.every(clause=>clause.status==='missing')?'missing':'partial'
 return `| ${cells[1]} | ${cells[2]} | ${linked.map(clause=>'`'+clause.id+'` '+clause.status).join('; ')} | ${status} |`
})
const outputs={'CONTRACT.md':source,'ACCEPTANCE.md':acceptance,'docs/CLAIMS.md':'<!-- Generated from CONTRACT.md. -->\n# Porthole homepage claims\n\n| Claim | Section | Clauses | Status |\n| --- | --- | --- | --- |\n'+claimRows.join('\n')+'\n'}
for(const [path,contents]of Object.entries(outputs)){
 if(command==='check'){if(!existsSync(path)||read(path)!==contents)throw Error(path+': generated content differs')}
 else{if(path.startsWith('docs/'))mkdirSync('docs',{recursive:true});writeFileSync(path,contents)}
}
parseContract(source)
console.log('Contract documents '+(command==='check'?'are current':'regenerated')+' for '+selected.join(', '))
