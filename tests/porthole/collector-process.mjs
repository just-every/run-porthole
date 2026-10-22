import { request } from 'node:https'

// A disposable collector process, using the real authenticated heartbeat door.
// Configuration arrives over stdin so its credential never appears in argv.
let input=''
for await (const chunk of process.stdin)input+=chunk
const {origin,secret,heartbeat}=JSON.parse(input),url=new URL('/api/v1/health/heartbeat',origin)
if(url.hostname!=='127.0.0.1'||url.protocol!=='https:')throw Error('local_collector_only')
const body=JSON.stringify(heartbeat)
async function beat() {
 await new Promise((resolve,reject)=>{
  // Trust only this disposable localhost listener's self-signed TLS endpoint.
  const outgoing=request(url,{method:'POST',timeout:10000,rejectUnauthorized:false,headers:{authorization:`Bearer ${secret}`,'content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{
   response.resume();response.on('end',()=>response.statusCode===200?resolve():reject(Error('collector_heartbeat_refused')))
  })
  outgoing.on('timeout',()=>outgoing.destroy());outgoing.on('error',()=>reject(Error('collector_listener_unavailable')));outgoing.end(body)
 })
}
await beat();process.stdout.write('ready\n')
setInterval(()=>beat().catch(()=>process.exit(1)),1000)
