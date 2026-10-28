import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {parseContract} from '../../src/base/seed-contract.mjs'
const [mode,...args]=process.argv.slice(2)
if(!['write','check'].includes(mode)||args.some(arg=>!/^PORT-\d{3}$/.test(arg)))throw Error('Usage: contract-docs.mjs write|check [PORT-NNN ...]')
const path='CONTRACT.md',original=await readFile(path,'utf8')
const rows=[...original.matchAll(/^\| `([^`]+)` \| ([^|]+) \| (published|target|push-further) \| (done|partial|missing) \|/gm)].map(match=>({id:match[1],kind:match[3],status:match[4]}))
const count=selected=>['done','partial','missing'].map(status=>selected.filter(row=>row.status===status).length).concat(selected.length)
// Counts are derived before the shared parser checks the complete contract.
const text=original.replace(/^(\| (All|Published|Target and push further|Published and target|Push-further) \|)[^\n]+/gm,(_,prefix,label)=>`${prefix} ${count(rows.filter(row=>label==='All'||(label==='Published'?row.kind==='published':label==='Target and push further'?row.kind!=='published':label==='Push-further'?row.kind==='push-further':row.kind!=='push-further'))).join(' | ')} |`)
const contract=parseContract(text)
for(const id of args)if(!contract.clauses.some(clause=>clause.id===id))throw Error('Unknown touched clause '+id)
const entry=clause=>`- **${clause.id} — ${clause.title}. Status: ${clause.status}.** ${clause.text}`
let acceptance=await readFile('ACCEPTANCE.md','utf8')
const touched=args.length?args:contract.clauses.map(clause=>clause.id)
for(const id of touched) {
 const clause=contract.clauses.find(clause=>clause.id===id)
 const pattern=new RegExp(`^- \\*\\*${id} [^\\n]*(?:\\n(?!- \\*\\*PORT-)[^\\n]*)*`,'m')
 if(!pattern.test(acceptance))throw Error('Missing acceptance view '+id)
 acceptance=acceptance.replace(pattern,entry(clause)+'\n')
}
acceptance=acceptance.replace(/All \*\*\d+\*\* clauses comprise \*\*\d+\*\* target and \d+ push-further: \d+ are \*\*done\*\*, \d+ are \*\*partial\*\* and \d+ are \*\*missing\*\*/g,`All **${contract.counts.total}** clauses comprise **${rows.filter(row=>row.kind!=='push-further').length}** target and ${rows.filter(row=>row.kind==='push-further').length} push-further: ${contract.counts.done} are **done**, ${contract.counts.partial} are **partial** and ${contract.counts.missing} are **missing**`)

const claims=['# Contract claims','','Generated from CONTRACT.md. The Status table is the authority.','',`| Clause | Status | Evidence | Gap |`,'| --- | --- | --- | --- |',...text.split('\n').filter(line=>/^\| `PORT-\d+` \|/.test(line)).map(line=>{const cells=line.split('|').slice(1,-1).map(cell=>cell.trim());return `| ${cells[0]} | ${cells[3]} | ${cells[4]} | ${cells[5]} |`})].join('\n')+'\n'
for(const [file,expected]of [[path,text],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]) {
 if(mode==='write'){await mkdir(file.includes('/')?file.slice(0,file.lastIndexOf('/')):'.',{recursive:true});await writeFile(file,expected)}
 else if(await readFile(file,'utf8').catch(()=>null)!==expected)throw Error('Stale generated contract document: '+file)
}
console.log(`Contract documents ${mode}: ${contract.counts.total} clauses; ${args.length?args.join(', '):'all clauses'}`)
