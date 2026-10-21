import { createHash } from 'node:crypto'
import { mkdir,readFile,writeFile,rename,open,stat } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { pathToFileURL } from 'node:url'
const api='/api/porthole/v1/archive'
const hash=value=>createHash('sha256').update(value).digest('hex')
const fileJSON=async path=>JSON.parse(await readFile(path,'utf8'))
async function exists(path){try{await stat(path);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
async function saveJSON(path,value){await writeFile(path+'.new',JSON.stringify(value),{mode:0o600});await rename(path+'.new',path)}
function checkChunk(chunk,index,previousHash){
 const {digest,...base}=chunk
 if(chunk.version!==1||chunk.index!==index||chunk.previousHash!==previousHash||!Array.isArray(chunk.rows)||!chunk.rows.length||hash(JSON.stringify(base))!==digest)throw Error('Archive chunk integrity failed')
 return digest
}
export async function verifyDirectory(directory,expectedManifestDigest){
 const manifestBytes=await readFile(join(directory,'manifest.json')),manifestDigest=hash(manifestBytes),manifest=JSON.parse(manifestBytes.toString('utf8'))
 if(expectedManifestDigest&&manifestDigest!==expectedManifestDigest)throw Error('Manifest digest does not match retained checkpoint')
 if(manifest.format!=='porthole.product-archive.v1'||manifest.inactive!==true||!Number.isSafeInteger(manifest.chunks)||manifest.chunks<0||!Number.isSafeInteger(manifest.rowCount)||manifest.rowCount<0||typeof manifest.tables!=='object'||!manifest.tables)throw Error('Unsupported archive manifest')
 let previousHash='0'.repeat(64),rows=0;const counts=Object.fromEntries(Object.keys(manifest.tables).map(table=>[table,0]))
 for(let index=0;index<manifest.chunks;index++){
  const chunk=await fileJSON(join(directory,`chunk-${index}.json`));previousHash=checkChunk(chunk,index,previousHash)
  for(const row of chunk.rows){if(!(row.table in counts))throw Error('Unknown archive table');counts[row.table]++;rows++}
 }
 if(rows!==manifest.rowCount||previousHash!==manifest.rootHash||Object.entries(counts).some(([table,count])=>count!==manifest.tables[table]))throw Error('Archive manifest counts or root digest failed')
 return {manifest,manifestDigest}
}
async function transport(origin,cookie,path,data){
 let response
 try {response=await fetch(origin+api+path,{method:data===undefined?'GET':'POST',redirect:'manual',headers:{cookie,...(data===undefined?{}:{origin,'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})})}catch{throw Error('Archive endpoint unavailable')}
 if(!response.ok){let code='request_failed';try{const value=await response.json();if(typeof value.error==='string'&&/^[a-z_]+$/.test(value.error))code=value.error}catch{}throw Error(`Archive request refused (${response.status} ${code})`)}
 return response
}
export async function runArchive({operation,origin,directory,cookie,confirm=false,expectedManifestDigest}){
 const parsed=new URL(origin);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('Use the installation origin without credentials or a path')
 origin=parsed.origin;directory=resolve(directory)
 if(operation==='verify')return verifyDirectory(directory,expectedManifestDigest)
 if(!cookie)throw Error('Set PORTHOLE_ARCHIVE_COOKIE to a fresh native owner session; bearer credentials cannot archive')
 if(operation==='export'){
  await mkdir(directory,{recursive:true,mode:0o700})
  const progressPath=join(directory,'export-progress.json')
  let progress
  if(await exists(progressPath)){progress=await fileJSON(progressPath);if(progress.origin!==origin)throw Error('Export directory belongs to another installation')}
  else {const job=await(await transport(origin,cookie,'/exports',{})).json();progress={origin,id:job.id,next:0,hash:'0'.repeat(64)};await saveJSON(progressPath,progress)}
  const job=await(await transport(origin,cookie,`/exports/${progress.id}`)).json(),total=job.totalChunks
  // Each response is one bounded chunk, streamed to disk before the cursor is
  // advanced. A lost response or interrupted write can replay the same cursor.
  for(let index=progress.next;index<total;index++){
   const response=await transport(origin,cookie,`/exports/${progress.id}/chunks/${index}`),path=join(directory,`chunk-${index}.json`),file=await open(path+'.new','w',0o600)
   try{for await(const part of response.body)await file.write(part)}finally{await file.close()}
   const chunk=await fileJSON(path+'.new'),nextHash=checkChunk(chunk,index,progress.hash)
   await rename(path+'.new',path);progress={...progress,next:index+1,hash:nextHash};await saveJSON(progressPath,progress)
  }
  const manifest=await(await transport(origin,cookie,`/exports/${progress.id}/manifest`)).json();await saveJSON(join(directory,'manifest.json'),manifest)
  return verifyDirectory(directory,expectedManifestDigest)
 }
 if(operation==='restore'){
  if(!confirm)throw Error('Restore requires --confirm after reviewing the manifest and inactive destination policy')
  const verified=await verifyDirectory(directory,expectedManifestDigest),{manifest}=verified,progressPath=join(directory,`restore-${hash(origin).slice(0,16)}.json`)
  let progress
  if(await exists(progressPath)){progress=await fileJSON(progressPath);if(progress.rootHash!==manifest.rootHash)throw Error('Restore progress belongs to a different manifest')}
  else {const job=await(await transport(origin,cookie,'/restores',{manifest})).json();progress={id:job.id,rootHash:manifest.rootHash};await saveJSON(progressPath,progress)}
  let status=await(await transport(origin,cookie,`/restores/${progress.id}`)).json()
  for(let index=status.nextChunk;index<manifest.chunks;index++)status=await(await transport(origin,cookie,`/restores/${progress.id}/chunks`,{chunk:await fileJSON(join(directory,`chunk-${index}.json`))})).json()
  status=await(await transport(origin,cookie,`/restores/${progress.id}/commit`,{confirm:manifest.rootHash})).json()
  if(status.state!=='committed')throw Error('Restore did not commit')
  return {...verified,status}
 }
 throw Error('Use export, restore or verify')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try {
  const [operation,origin,directory,...flags]=process.argv.slice(2)
  if(!operation||!origin||!directory||flags.some(flag=>flag!=='--confirm'&&!/^--manifest-sha256=[a-f0-9]{64}$/.test(flag)))throw Error('Usage: node scripts/porthole/archive.mjs export|restore|verify ORIGIN DIRECTORY [--confirm] [--manifest-sha256=DIGEST]')
  const result=await runArchive({operation,origin,directory,cookie:process.env.PORTHOLE_ARCHIVE_COOKIE,confirm:flags.includes('--confirm'),expectedManifestDigest:flags.find(flag=>flag.startsWith('--manifest-sha256='))?.split('=')[1]})
  process.stdout.write(`${operation==='restore'?'Restored inactive product':'Verified archive'}: ${result.manifest.rowCount} rows, ${result.manifest.chunks} chunks\nManifest SHA-256: ${result.manifestDigest}\n`)
 }catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1}
}
