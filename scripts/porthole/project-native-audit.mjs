import {readFile,writeFile,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {parseJsonc} from '@runeditrun/rer/jsonc'
import {getPlatformProxy} from 'wrangler'
import {projectFacts} from '../../src/porthole/audit/facts.ts'

// The runner invokes this only under its local operation lock, after migrations.
// Open data bindings only: no application session or provider key is loaded.
const root=process.cwd(),config=parseJsonc(await readFile(join(root,'wrangler.jsonc'),'utf8'))
const path=join(root,'.wrangler',`porthole-audit-${process.pid}.json`)
await mkdir(join(root,'.wrangler'),{recursive:true})
await writeFile(path,JSON.stringify(Object.fromEntries(['name','compatibility_date','compatibility_flags','d1_databases','r2_buckets'].filter(key=>config[key]!==undefined).map(key=>[key,config[key]]))),{mode:0o600})
let proxy
try {
 proxy=await getPlatformProxy({configPath:path,persist:{path:join(root,'.wrangler/state/v3')},remoteBindings:false})
 await projectFacts(proxy.env.DB)
 console.log('Private archive audit projected.')
} finally {await proxy?.dispose();await rm(path,{force:true})}
