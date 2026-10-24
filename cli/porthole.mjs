import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {client,definitionPages,queryPages} from './client.mjs'

async function readInput(stream) {
 let raw=''
 for await(const chunk of stream){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw Error('Input exceeds 8192 bytes')}
 let value
 try {value=JSON.parse(raw)}catch {throw Error('Supply a JSON object on stdin')}
 if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Supply a JSON object on stdin')
 return value
}
export async function run(args,{env=process.env,input=process.stdin,output=process.stdout}={}) {
 const [origin,command,...rest]=args
 const request=client({origin,credential:env.PORTHOLE_CREDENTIAL,session:env.PORTHOLE_SESSION})
 const emit=value=>output.write(JSON.stringify(value)+'\n')
 if(command==='query') {
  if(rest.some(arg=>arg!=='--all'))throw Error('Usage: porthole ORIGIN query [--all] < query.json')
  for await(const page of queryPages(request,{query:await readInput(input),all:rest.includes('--all')}))emit(page)
  return
 }
 const [collection,id,...flags]=rest
 if(!['monitors','repairs'].includes(collection))throw Error('Use monitors or repairs')
 const root=`/api/porthole/v1/configuration/${collection}`
 if(command==='list') {
  const all=rest.slice(1).includes('--all'),options=rest.slice(1).filter(arg=>arg!=='--all')
  let limit=50,cursor
  for(let index=0;index<options.length;index+=2) {
   if(options[index]==='--limit')limit=Number(options[index+1])
   else if(options[index]==='--cursor')cursor=options[index+1]
   else throw Error('Usage: porthole ORIGIN list COLLECTION [--all] [--limit N] [--cursor CURSOR]')
  }
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('Limit must be between 1 and 200')
  for await(const page of definitionPages(request,{collection,limit,cursor,all}))emit(page)
  return
 }
 if(command==='get') {
  if(!id || flags.length)throw Error('Usage: porthole ORIGIN get COLLECTION ID')
  emit(await request(root+'/'+encodeURIComponent(id)));return
 }
 if(!['create','update'].includes(command))throw Error('Use list, get, query, create or update')
 const options=command==='create'?rest.slice(1):flags
 let key,revision
 for(let index=0;index<options.length;index+=2) {
  if(options[index]==='--key')key=options[index+1]
  else if(options[index]==='--revision')revision=Number(options[index+1])
  else throw Error('Mutations require --key KEY and updates require --revision N')
 }
 if(!key || command!=='create' && (!id || !Number.isSafeInteger(revision) || revision<1))throw Error('Mutations require --key KEY and updates require --revision N')
 const method={create:'POST',update:'PUT'}[command]
 emit(await request(command==='create'?root:root+'/'+encodeURIComponent(id),{method,key,revision,body:await readInput(input)}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {await run(process.argv.slice(2))}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1}
}
