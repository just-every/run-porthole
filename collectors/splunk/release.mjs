import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createReadStream,createWriteStream} from 'node:fs'
import {chmod,mkdir,rename,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {Readable,Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {pathToFileURL} from 'node:url'

// Official release asset digests, obtained from GitHub's release API over HTTPS.
// Qualification checks executable bytes even when the caller supplies a path.
export const release='v0.135.0'
const assets={
 'darwin-arm64':{name:'otelcol_darwin_arm64',size:383056848,sha256:'53e83dcaf2addae2e0f0cd8be1327bf47f9f2acb633db634e930e64117c8b78f'},
 'linux-x64':{name:'otelcol_linux_amd64',size:395166374,sha256:'b067f02792fa428abae70ba58a1e734031d8bab92276eef1f36cb1c7571725b8'}
}
function asset(){
 const value=assets[process.platform+'-'+process.arch]
 assert.ok(value,'Splunk collector qualification supports macOS arm64 and Linux x64')
 return value
}
export async function verifyCollector(path){
 assert.ok(path,'PORTHOLE_SPLUNK_COLLECTOR_BIN must name a verified official Splunk collector; acquire it explicitly with node collectors/splunk/release.mjs')
 const expected=asset(),hash=createHash('sha256');let size=0
 for await(const bytes of createReadStream(path)){hash.update(bytes);size+=bytes.length}
 assert.equal(size,expected.size,'official Splunk collector asset size')
 assert.equal(hash.digest('hex'),expected.sha256,'official Splunk collector SHA-256')
 return resolve(path)
}
export async function acquireCollector(directory=process.env.PORTHOLE_SPLUNK_COLLECTOR_CACHE??'.cache/splunk-collector'){
 const expected=asset(),target=resolve(directory,release,expected.name)
 try{return await verifyCollector(target)}catch(error){if(error.code!=='ENOENT')throw error}
 await mkdir(join(resolve(directory),release),{recursive:true,mode:0o700})
 const temporary=target+'.'+process.pid+'.partial',hash=createHash('sha256');let size=0
 try{
  const response=await fetch('https://github.com/signalfx/splunk-otel-collector/releases/download/'+release+'/'+expected.name,{signal:AbortSignal.timeout(240000)})
  assert.equal(response.status,200,'official Splunk release download')
  assert.ok(response.body,'official Splunk release body')
  const integrity=new Transform({transform(bytes,_encoding,done){
   size+=bytes.length
   if(size>expected.size){done(Error('Official Splunk collector exceeds its published asset size'));return}
   hash.update(bytes);done(null,bytes)
  }})
  await pipeline(Readable.fromWeb(response.body),integrity,createWriteStream(temporary,{flags:'wx',mode:0o600}))
  assert.equal(size,expected.size,'complete official Splunk release download')
  assert.equal(hash.digest('hex'),expected.sha256,'downloaded official Splunk collector SHA-256')
  await chmod(temporary,0o700);await rename(temporary,target)
  return target
 }finally{await rm(temporary,{force:true})}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 assert.equal(process.argv.length,2,'Set PORTHOLE_SPLUNK_COLLECTOR_CACHE for a different cache directory; no command arguments are accepted')
 try{console.log(await acquireCollector())}catch{console.error('Official Splunk collector acquisition or integrity verification failed');process.exitCode=1}
}
