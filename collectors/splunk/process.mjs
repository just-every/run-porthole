import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {fileURLToPath} from 'node:url'

export const configPath=fileURLToPath(new URL('./collector.yaml',import.meta.url))
// Do not carry unrelated provider credentials into either subprocess.
export function privateProcessEnvironment(){
 return Object.fromEntries(['PATH','HOME','TMPDIR','TEMP','TMP','SYSTEMROOT','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE'].filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]]))
}
export async function freePort(){
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening')
 const port=server.address().port;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
 return port
}
export async function until(check,message,timeout=15000){
 const deadline=Date.now()+timeout
 while(Date.now()<deadline){if(await check())return;await delay(100)}
 assert.fail(message)
}
export async function startCollector({binary,port,healthPort,destination,authorization}){
 const child=spawn('nice',['-n','15',binary,'--config='+configPath],{
  env:{...privateProcessEnvironment(),GOMAXPROCS:'2',PORTHOLE_COLLECTOR_LISTEN:'127.0.0.1:'+port,PORTHOLE_COLLECTOR_HEALTH_LISTEN:'127.0.0.1:'+healthPort,PORTHOLE_COLLECTOR_DESTINATION:destination,PORTHOLE_COLLECTOR_AUTHORIZATION:authorization},
  stdio:['ignore','pipe','pipe']
 })
 let launchError,diagnostic='',stopped=false
 child.on('error',error=>{launchError=error})
 const capture=bytes=>{diagnostic=(diagnostic+String(bytes)).slice(-12000)}
 child.stdout.on('data',capture);child.stderr.on('data',capture)
 const exited=once(child,'exit').catch(()=>{})
 const hardTimeout=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')},120000)
 const stop=async()=>{
  if(stopped)return;stopped=true;clearTimeout(hardTimeout)
  if(child.exitCode===null&&child.signalCode===null&&!launchError){
   child.kill('SIGTERM')
   const graceful=await Promise.race([exited.then(()=>true),delay(5000).then(()=>false)])
   if(!graceful){child.kill('SIGKILL');await exited}
  }
 }
 const healthy=()=>{
  if(launchError)throw Error('Official Splunk collector could not start')
  if(child.exitCode!==null||child.signalCode!==null)throw Error('Official Splunk collector exited: '+diagnostic.split(authorization).join('[redacted]').split(authorization.replace(/^Bearer /,'')).join('[redacted]').replace(/[A-Za-z0-9_-]{32,}/g,'[redacted]'))
 }
 try{
  await until(async()=>{healthy();return fetch('http://127.0.0.1:'+healthPort,{signal:AbortSignal.timeout(1000)}).then(response=>response.ok).catch(()=>false)},'official Splunk collector readiness')
  return {stop,healthy}
 }catch(error){await stop();throw error}
}
