import { open, readFile, rename, mkdir, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const hash = data => createHash('sha256').update(data).digest('hex')
async function save(path, data) {
 const file = await open(path+'.new','w',0o600)
 try { await file.writeFile(data); await file.sync() } finally { await file.close() }
 await rename(path+'.new',path)
}
function transport(origin, { credential, cookie }) {
 let url
 try { url = new URL(origin) } catch { throw Error('Use the installation origin') }
 if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw Error('Use an HTTPS installation origin or loopback HTTP')
 if (credential && !/^ph_[A-Za-z0-9_-]{43}$/.test(credential) || !credential && !cookie) throw Error('Set PORTHOLE_CREDENTIAL or PORTHOLE_COOKIE')
 return async (path, body) => {
  let response
  try { response = await fetch(new URL('/api/porthole/v1/exports'+path,url),{method:body===undefined?'GET':'POST',redirect:'error',headers:{origin:url.origin,...(credential?{authorization:'Bearer '+credential}:{cookie}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}) } catch { throw Error('Export endpoint unavailable') }
  if (!response.ok) {
   let code = 'export_refused'
   try { const data = await response.json(); if (/^[a-z_]+$/.test(data.error)) code = data.error } catch {}
   const retry = response.headers.get('retry-after')
   throw Error(`Export refused (${response.status} ${code})${retry && /^\d+$/.test(retry)?'; retry after '+retry+' seconds':''}`)
  }
  return response
 }
}
export async function runExport({ operation, origin, credential, cookie, selection, id, directory, format='ndjson', maxPages=Infinity, credentialId }) {
 const request = transport(origin,{credential,cookie})
 if (operation === 'preview') return (await request('',selection)).json()
 if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw Error('Supply an export ID')
 if (operation === 'approve' || operation === 'cancel') return (await request('/'+id+'/'+operation,{confirm:id,...(credentialId?{credentialId}:{})})).json()
 if (operation !== 'download' || !directory || !['ndjson','otlp-json'].includes(format) || !(maxPages===Infinity || Number.isSafeInteger(maxPages) && maxPages>0)) throw Error('Supply a download directory and valid format')
 await mkdir(directory,{recursive:true,mode:0o700})
 const checkpoint = join(directory,'progress.json')
 let progress
 try { progress = JSON.parse(await readFile(checkpoint,'utf8')) } catch(error) {
  if (error.code !== 'ENOENT') throw Error('Invalid export checkpoint')
  if ((await readdir(directory)).length) throw Error('A new export needs an empty directory')
  progress = { version:1,origin:new URL(origin).origin,id,format,cursor:null,complete:false,pages:[] }
  await save(checkpoint,JSON.stringify(progress)+'\n')
 }
 if (progress.version!==1 || progress.origin!==new URL(origin).origin || progress.id!==id || progress.format!==format || !Array.isArray(progress.pages)) throw Error('Checkpoint belongs to another export')
 for (const [index,page] of progress.pages.entries()) {
  const data = await readFile(join(directory,`page-${String(index).padStart(8,'0')}.ndjson`))
  if (hash(data)!==page.sha256) throw Error('Downloaded page integrity mismatch')
 }
 let downloaded = 0
 while (!progress.complete && downloaded < maxPages) {
  const params = new URLSearchParams({format,...(progress.cursor?{cursor:progress.cursor}:{})})
  const response = await request('/'+id+'/pages?'+params)
  if (response.headers.get('x-porthole-export') !== id || !/^\d+$/.test(response.headers.get('x-porthole-records') ?? '')) throw Error('Invalid export page')
  // Write each bounded response directly to disk. Progress follows the atomic
  // page rename, so an interruption safely replays the same numbered page.
  const index = progress.pages.length, path = join(directory,`page-${String(index).padStart(8,'0')}.ndjson`)
  const file = await open(path+'.new','w',0o600), digest = createHash('sha256')
  try { for await (const chunk of response.body) { await file.writeFile(chunk); digest.update(chunk) }; await file.sync() } finally { await file.close() }
  await rename(path+'.new',path)
  progress.pages.push({records:Number(response.headers.get('x-porthole-records')),sha256:digest.digest('hex')})
  progress.cursor = response.headers.get('x-porthole-next-cursor') || null
  progress.complete = progress.cursor === null
  await save(checkpoint,JSON.stringify(progress)+'\n')
  downloaded++
 }
 return {id,complete:progress.complete,pages:progress.pages.length,records:progress.pages.reduce((sum,page)=>sum+page.records,0)}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try {
  const args = process.argv.slice(2), flags = args.filter(value=>value.startsWith('--'))
  const [operation,origin,id,directory,...extra] = args.filter(value=>!value.startsWith('--'))
  if (extra.length || !['preview','approve','cancel','download'].includes(operation) || !origin || operation==='preview' && id || ['approve','cancel'].includes(operation) && directory || flags.some(flag=>!/^--(?:format=(?:ndjson|otlp-json)|max-pages=[1-9][0-9]*|credential-id=[a-f0-9-]{36})$/.test(flag))) throw Error('Usage: node scripts/porthole/export.mjs preview ORIGIN < selection.json; approve|cancel ORIGIN ID [--credential-id=ID]; download ORIGIN ID DIRECTORY [--format=otlp-json] [--max-pages=N]')
  let selection
  if (operation==='preview') { let text=''; for await (const chunk of process.stdin) {text+=chunk;if(Buffer.byteLength(text)>8192)throw Error('Selection exceeds 8192 bytes')}; try{selection=JSON.parse(text)}catch{throw Error('Supply a selection JSON object')} }
  const options=Object.fromEntries(flags.map(flag=>flag.slice(2).split('=')))
  const result=await runExport({operation,origin,id,directory,selection,credential:process.env.PORTHOLE_CREDENTIAL,cookie:process.env.PORTHOLE_COOKIE,format:options.format,maxPages:options['max-pages']?Number(options['max-pages']):Infinity,credentialId:options['credential-id']})
  process.stdout.write(JSON.stringify(result)+'\n')
 } catch(error) { process.stderr.write((error.code?'Export file operation failed':error.message)+'\n'); process.exitCode=1 }
}
