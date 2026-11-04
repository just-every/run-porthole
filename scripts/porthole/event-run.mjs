import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'

// Run an actual local command, and send its execution facts through the native
// versioned API. The native session stays in the child environment only.
const [origin,service,environment,team,...args]=process.argv.slice(2)
if(args[0]!=='--'||args.length<2||!process.env.PORTHOLE_SESSION)throw Error('Usage: event-run.mjs ORIGIN SERVICE ENVIRONMENT TEAM -- COMMAND [ARG...] with PORTHOLE_SESSION')
const runId=randomUUID(),epoch=BigInt(Date.now())*1000000n,start=process.hrtime.bigint()
const time=()=>String(epoch+process.hrtime.bigint()-start)
const occurrence=time(),child=spawn(args[1],args.slice(2),{stdio:'ignore',env:{...process.env,PORTHOLE_SESSION:''}})
const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}))})
const completion=time(),events=[]
for(const [phase,at]of [['started',occurrence],['completed',completion]]) {
 const input={source:'native-command',sourceId:runId+':'+phase,title:'Local command '+phase,text:phase==='completed'?'Exit code '+String(exit.code)+'; signal '+String(exit.signal):'Local command execution started',service,environment,team,severity:phase==='completed'&&exit.code!==0?'error':'info',occurredAt:at,correlationKey:runId,resource:'local-command',tags:['execution:'+phase]}
 const response=await fetch(new URL('/api/porthole/v1/events',origin),{method:'POST',headers:{origin,cookie:process.env.PORTHOLE_SESSION,'content-type':'application/json'},body:JSON.stringify(input)})
 if(response.status!==201)throw Error('Execution event submission refused: '+response.status)
 const result=await response.json();events.push({input,id:result.event.id})
}
console.log(JSON.stringify({runId,exit,events}))
process.exitCode=exit.code??1
