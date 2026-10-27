import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises'
import {resolve} from 'node:path'
const execute=promisify(execFile)
export const version='0.135.0'
const digest='43132748eb0effb56b9d508ca789149684bf7ab6ade5d65cd0b22c4d265a30c0'
export async function acquireCollector(directory='.cache/otel-collector') {
 assert.equal(process.platform+'-'+process.arch,'linux-x64','This bounded qualification pins the official Linux x64 collector.')
 const target=resolve(directory);await mkdir(target,{recursive:true})
 const archive=target+'/collector.tar.gz'
 try{await readFile(archive)}catch(error){
  if(error.code!=='ENOENT')throw error
  const metadata=JSON.parse((await execute('gh',['api','/repos/open-telemetry/opentelemetry-collector-releases/releases/tags/v'+version],{maxBuffer:2000000})).stdout)
  const asset=metadata.assets.find(a=>a.name==='otelcol-contrib_'+version+'_linux_amd64.tar.gz')
  assert.ok(asset,'official collector release archive')
  const file=archive+'.'+process.pid+'.partial'
  try {
   // Stream the official API asset; no account token enters source or argv.
   const {spawn}=await import('node:child_process'),{createWriteStream}=await import('node:fs'),{pipeline}=await import('node:stream/promises')
   const child=spawn('gh',['api','/repos/open-telemetry/opentelemetry-collector-releases/releases/assets/'+asset.id,'-H','Accept: application/octet-stream'],{stdio:['ignore','pipe','inherit']})
   const result=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Official collector download failed')))})
   await Promise.all([pipeline(child.stdout,createWriteStream(file,{flags:'wx'})),result]);await rename(file,archive)
  }finally{await rm(file,{force:true})}
 }
 const bytes=await readFile(archive)
 assert.equal(bytes.length,90545276,'official collector asset size')
 assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,'official collector archive integrity')
 await execute('tar',['-xzf',archive,'-C',target,'otelcol-contrib'])
 return target+'/otelcol-contrib'
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(await acquireCollector())
