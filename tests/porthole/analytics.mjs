import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {cp,mkdtemp,rm} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {stageAnalytics} from '../../scripts/analytical/stage.mjs'

const execute=promisify(execFile),root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'porthole-analytics-'))
const wrangler=join(root,'node_modules/wrangler/bin/wrangler.js'),token='synthetic-porthole-1000',sourceIdentity=randomUUID()
const env={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}
const servers=[]
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function port(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value}
async function start(server){
 server.output=''
 server.child=spawn(process.execPath,[wrangler,'dev','--local','--config',server.config,'--persist-to',server.persist,'--port',String(server.port),'--inspector-port','0','--ip','127.0.0.1','--var',`ANALYTICS_TOKEN:${token}`],{cwd:scratch,env,stdio:['ignore','pipe','pipe']})
 const capture=chunk=>{server.output=(server.output+chunk).slice(-10000)}
 server.child.stdout.on('data',capture);server.child.stderr.on('data',capture)
 for(let i=0;i<120;i++){
  if(server.child.exitCode!==null)throw Error(server.output)
  try{if((await fetch(server.origin+'/health')).ok)return}catch{}
  await pause(250)
 }
 throw Error('Analytical Worker readiness failed')
}
async function stop(server){if(server.child?.exitCode===null){const exited=new Promise(resolve=>server.child.once('exit',resolve));server.child.kill('SIGTERM');await exited}}
const post=(server,path,data,auth=true)=>fetch(server.origin+path,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)})
async function value(response){assert.equal(response.status,200,await response.clone().text());return response.json()}
try {
 await cp(join(root,'workers/analytics'),join(scratch,'workers/analytics'),{recursive:true,filter:path=>!path.includes('/.staged')&&!path.includes('/.state')})
 for(const product of await stageAnalytics(scratch)){
  const listener=await port(),server={config:join(scratch,product.config),persist:join(scratch,product.role),port:listener,origin:`http://127.0.0.1:${listener}`}
  servers.push(server)
  await execute(process.execPath,[wrangler,'d1','migrations','apply','DB','--local','--config',server.config,'--persist-to',server.persist],{cwd:scratch,env})
  await start(server)
 }
 const [primary,standby]=servers,now=Date.now(),scope={services:['checkout'],environments:['production'],teams:['commerce']}
 const batch=sequence=>{
  const id=`synthetic-porthole-${1000+sequence}`,payload={record:{body:{stringValue:`synthetic-porthole-${1010+sequence}`}}}
  return {id,completionSequence:sequence,sourceId:'synthetic-porthole-1020',signal:'logs',digest:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),acceptedAt:now,completedAt:now+1,records:[{id:id+':0',ordinal:0,team:'commerce',service:'checkout',environment:'production',eventTimeNs:String(BigInt(now)*1000000n+BigInt(sequence)).padStart(20,'0'),traceId:null,spanId:null,payload,indexedAt:now+1,late:0,outOfOrder:0}]}
 }
 const first=batch(1),second=batch(2),query={sourceIdentity,requiredWatermark:1,signal:'logs',from:'0',through:'18446744073709551615',scope}
 assert.equal((await post(primary,'/v1/query',query,false)).status,401)
 await value(await post(primary,'/v1/replicate',{sourceIdentity,batches:[first]}))
 await value(await post(primary,'/v1/replicate',{sourceIdentity,batches:[first]}))
 let read=await value(await post(primary,'/v1/query',query))
 assert.equal(read.records.length,1);assert.equal(read.records[0].event_time_ns,first.records[0].eventTimeNs);assert.deepEqual(read.records[0].payload,first.records[0].payload)
 const conflict=structuredClone(first);conflict.records[0].payload.record.body.stringValue='synthetic-porthole-1030'
 assert.equal((await post(primary,'/v1/replicate',{sourceIdentity,batches:[conflict]})).status,409)
 assert.equal((await post(primary,'/v1/query',{...query,service:'billing'})).status,403)
 await value(await post(standby,'/v1/replicate',{sourceIdentity,batches:[second]}))
 assert.equal((await post(standby,'/v1/coverage',{sourceIdentity,requiredWatermark:2})).status,409,'a high received sequence cannot hide a missing prefix')
 await value(await post(standby,'/v1/replicate',{sourceIdentity,batches:[first]}))
 assert.equal((await value(await post(standby,'/v1/coverage',{sourceIdentity,requiredWatermark:2}))).watermark,2)
 await stop(primary)
 await assert.rejects(()=>fetch(primary.origin+'/health'))
 read=await value(await post(standby,'/v1/query',{...query,requiredWatermark:2}))
 assert.equal(read.records.length,2,'standby answers while the primary process is actually stopped')
 await start(primary)
 await value(await post(primary,'/v1/replicate',{sourceIdentity,batches:[second,first]}))
 read=await value(await post(primary,'/v1/query',{...query,requiredWatermark:2,snapshot:1}))
 assert.equal(read.records.length,1);assert.equal(read.records[0].id,first.records[0].id)
 const count=await value(await post(primary,'/v1/query',{...query,requiredWatermark:2,mode:'count'}));assert.equal(count.count,2)
 console.log('analyticalKernelJourney passed: separate Worker/D1 processes, private auth, exact replication/replay, stale standby refusal, actual process stop and original snapshot recovery; control-plane integration remains unqualified')
} finally {
 for(const server of servers)await stop(server)
 await rm(scratch,{recursive:true,force:true})
}
