import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { hostname } from 'node:os'
import { pathToFileURL } from 'node:url'

/** The caller supplies an installation and its scoped ingest credential over
 * stdin. Machine identity comes from the running host, never a remote probe. */
export function heartbeatCollector({origin,secret,heartbeat},{localTest=false}={}) {
 const url=new URL('/api/v1/health/heartbeat',origin)
 if(url.username||url.password||url.search||url.hash||url.protocol!=='https:'&&!(localTest&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('heartbeat_https_required')
 const body=JSON.stringify({...heartbeat,hostId:hostname()})
 return async()=>new Promise((resolve,reject)=>{
  const outgoing=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'POST',timeout:10000,...(localTest&&url.hostname==='127.0.0.1'?{rejectUnauthorized:false}:{}),headers:{authorization:`Bearer ${secret}`,'content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{
   const chunks=[];let size=0
   response.on('data',chunk=>{size+=chunk.length;if(size>16384)outgoing.destroy(Error('heartbeat_response_too_large'));else chunks.push(chunk)})
   response.on('error',()=>reject(Error('heartbeat_response_failed')))
   response.on('end',()=>{if(response.statusCode!==200)return reject(Error('heartbeat_refused'));try{resolve(JSON.parse(Buffer.concat(chunks)))}catch{reject(Error('heartbeat_response_invalid'))}})
  })
  outgoing.on('timeout',()=>outgoing.destroy());outgoing.on('error',()=>reject(Error('heartbeat_listener_unavailable')));outgoing.end(body)
 })
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  let input=''
  for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw Error('heartbeat_configuration_too_large')}
  const config=JSON.parse(input),interval=config.intervalSeconds??30
  if(!Number.isSafeInteger(interval)||interval<1||interval>3600)throw Error('heartbeat_interval_invalid')
  const beat=heartbeatCollector(config)
  while(true){await beat();await new Promise(resolve=>setTimeout(resolve,interval*1000))}
 }catch {process.stderr.write('Heartbeat collector stopped; check the installation, scoped credential and connection.\n');process.exitCode=1}
}
