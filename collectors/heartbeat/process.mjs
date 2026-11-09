import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { hostname } from 'node:os'
import { pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

export const heartbeatExit = Object.freeze({heartbeat_accepted:0,control_plane_unreachable:2,credential_refused:3,response_invalid:4,local_network_unavailable:5,request_refused:6,configuration_invalid:7})
const failure=code=>Object.assign(Error(code),{code})
export function heartbeatTransportFailure(error) {
 return ['ENETDOWN','ENETUNREACH','EHOSTUNREACH','EADDRNOTAVAIL'].includes(error?.code)?'local_network_unavailable':'control_plane_unreachable'
}
/** This checks only the existing authenticated acknowledgement path. It cannot
 * infer telemetry coverage or distinguish every remote failure from routing. */
export function heartbeatCollector({origin,secret,heartbeat},{localTest=false}={}) {
 const supplied=new URL(origin),url=new URL('/api/v1/health/heartbeat',supplied)
 if(supplied.username||supplied.password||supplied.search||supplied.hash||supplied.pathname!=='/'||url.protocol!=='https:'&&!(localTest&&url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw failure('configuration_invalid')
 if(typeof secret!=='string'||!secret.length||/[\r\n]/.test(secret)||!heartbeat||typeof heartbeat.collectorId!=='string')throw failure('configuration_invalid')
 const hostId=hostname(),body=JSON.stringify({...heartbeat,hostId})
 return async()=>new Promise((resolve,reject)=>{
  const outgoing=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'POST',timeout:10000,...(localTest&&url.hostname==='127.0.0.1'?{rejectUnauthorized:false}:{}),headers:{authorization:`Bearer ${secret}`,'content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{
   const chunks=[];let size=0
   response.on('data',chunk=>{size+=chunk.length;if(size>16384)outgoing.destroy(failure('response_invalid'));else chunks.push(chunk)})
   response.on('error',()=>reject(failure('response_invalid')))
   response.on('end',()=>{
    if([401,403].includes(response.statusCode))return reject(failure('credential_refused'))
    if(response.statusCode!==200)return reject(failure(response.statusCode>=500?'control_plane_unreachable':'request_refused'))
    try {
     const ack=JSON.parse(Buffer.concat(chunks))
     if(ack.status!=='heartbeat_accepted'||ack.collectorId!==heartbeat.collectorId||ack.hostId!==hostId||typeof ack.observedAt!=='string'||!Number.isFinite(Date.parse(ack.observedAt)))throw failure('response_invalid')
     resolve({collectorId:ack.collectorId,hostId,observedAt:ack.observedAt,status:ack.status})
    }catch {reject(failure('response_invalid'))}
   })
  })
  outgoing.on('timeout',()=>outgoing.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})))
  outgoing.on('error',error=>reject(failure(error.code==='response_invalid'?error.code:heartbeatTransportFailure(error))))
  outgoing.end(body)
 })
}
/** The supervisor receives one value-free JSON status per attempt and the last
 * observed status on termination. Failed attempts never end continuous mode. */
export async function runHeartbeat(config,{localTest=false,once=false,signal,write=line=>process.stdout.write(line+'\n')}={}) {
 const interval=config.intervalSeconds??30
 if(!Number.isSafeInteger(interval)||interval<1||interval>3600)throw failure('configuration_invalid')
 const beat=heartbeatCollector(config,{localTest})
 let lastAccepted=null,code='control_plane_unreachable'
 do {
  try {lastAccepted=await beat();code='heartbeat_accepted'}catch(error){code=Object.hasOwn(heartbeatExit,error.code)?error.code:'control_plane_unreachable'}
  write(JSON.stringify({check:'authenticated-heartbeat',status:code,exitStatus:heartbeatExit[code],checkedAt:new Date().toISOString(),lastAccepted,telemetryHealth:'Unknown'}))
  if(once||signal?.aborted)break
  try {await pause(interval*1000,undefined,{signal})}catch {break}
 }while(!signal?.aborted)
 return heartbeatExit[code]
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const abort=new AbortController()
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>abort.abort())
 try {
  if(process.argv.slice(2).some(value=>value!=='--once'))throw failure('configuration_invalid')
  let input=''
  for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw failure('configuration_invalid')}
  process.exitCode=await runHeartbeat(JSON.parse(input),{once:process.argv.includes('--once'),signal:abort.signal})
 }catch {process.stderr.write('Heartbeat check configuration invalid.\n');process.exitCode=heartbeatExit.configuration_invalid}
}
