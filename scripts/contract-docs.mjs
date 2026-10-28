import {readFile,writeFile} from 'node:fs/promises'
import {parseContract} from '../src/base/seed-contract.mjs'
// Narrow legacy projection until ct adopts the current contract format. Clause
// wording stays in CONTRACT.md; this command updates only named journey rows.
const [mode,...ids]=process.argv.slice(2)
if(!['write','check'].includes(mode)||!ids.length||ids.some(id=>!/^PORT-[0-9]{3}$/.test(id)))throw Error('Usage: contract-docs.mjs write|check PORT-012')
let source=await readFile('CONTRACT.md','utf8')
const rows=source.split('\n').filter(line=>/^\| `PORT-/.test(line)).map(line=>line.split('|').slice(1,-1).map(v=>v.trim()))
const counts=selected=>['done','partial','missing'].map(status=>selected.filter(row=>row[3]===status).length)
source=source.replace(/^\| (Published|Target and push further|All) \|.*$/gm,(_line,label)=>{
 const selected=label==='All'?rows:rows.filter(row=>label==='Published'?row[2]==='published':row[2]!=='published')
 return `| ${label} | ${counts(selected).join(' | ')} | ${selected.length} |`
})
const parsed=parseContract(source)
let acceptance=await readFile('ACCEPTANCE.md','utf8')
acceptance=acceptance.replace(/\d+ are \*\*done\*\*, \d+ are \*\*partial\*\* and \d+ are \*\*missing\*\*/,`${counts(rows)[0]} are **done**, ${counts(rows)[1]} are **partial** and ${counts(rows)[2]} are **missing**`)
for(const id of ids){
 const clause=parsed.clauses.find(c=>c.id===id)
 if(!clause)throw Error('Unknown clause '+id)
 const journey=clause.text.split('**Acceptance evidence:**')[1]?.trim()
 if(!journey)throw Error('Missing legacy acceptance '+id)
 const line=`- **${clause.id} — ${clause.title}. Status: ${clause.status}.** ${journey}${clause.evidence?' Evidence: '+clause.evidence:''}${clause.status==='done'?'':' Open scope: '+clause.gap}`
 const old=acceptance.split('\n').find(row=>row.startsWith('- **'+id+' —'))
 if(!old)throw Error('Missing journey row '+id)
 acceptance=acceptance.replace(old,line)
}
const claims='# Contract claims\n\nGenerated from CONTRACT.md. Only rows marked done are complete claims.\n\n'+parsed.clauses.map(c=>`- **${c.id} — ${c.title}**: ${c.status}. ${c.status==='done'?c.evidence:'Remaining: '+c.gap}`).join('\n')+'\n'
for(const [path,content]of [['CONTRACT.md',source],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]){
 if(mode==='write')await writeFile(path,content)
 else if(await readFile(path,'utf8')!==content)throw Error('Stale generated contract view: '+path)
}
console.log('Contract views '+(mode==='write'?'written':'fresh')+' for '+ids.join(', '))
