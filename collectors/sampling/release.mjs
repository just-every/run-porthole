import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,mkdtemp,readFile,rename,rm} from 'node:fs/promises'
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
  // Public release artifacts need no account authority. Preserve the pinned
  // archive digest below before extracting or executing any downloaded byte.
  const file=archive+'.'+process.pid+'.partial'
  try {
   await execute('curl',['--fail','--location','--retry','2','--connect-timeout','20','--max-time','180','--silent','--show-error','--output',file,'https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v'+version+'/otelcol-contrib_'+version+'_linux_amd64.tar.gz'],{timeout:200000})
   await rename(file,archive)
  }finally{await rm(file,{force:true})}
 }
 const bytes=await readFile(archive)
 assert.equal(bytes.length,90545276,'official collector asset size')
 assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,'official collector archive integrity')
 const extracted=await mkdtemp(target+'/extract-')
 try{await execute('tar',['-xzf',archive,'-C',extracted,'otelcol-contrib']);await rename(extracted+'/otelcol-contrib',target+'/otelcol-contrib')}finally{await rm(extracted,{recursive:true,force:true})}
 return target+'/otelcol-contrib'
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(await acquireCollector())
