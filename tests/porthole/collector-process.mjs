import { heartbeatCollector } from '../../collectors/heartbeat/process.mjs'

// Configuration stays on stdin; the actual product collector supplies its
// operating-system host identity and uses the real authenticated intake door.
let input=''
for await (const chunk of process.stdin)input+=chunk
const config=JSON.parse(input),url=new URL(config.origin)
if(url.hostname!=='127.0.0.1')throw Error('local_collector_only')
const beat=heartbeatCollector(config,{localTest:true})
const ready=await beat();process.stdout.write('ready\n');process.send?.(ready)
if(config.manual)process.on('message',async message=>{
 if(message!=='beat')return
 try{process.send?.(await beat())}catch{process.exit(1)}
})
else setInterval(()=>beat().catch(()=>process.exit(1)),1000)
