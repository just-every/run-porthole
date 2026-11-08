import { heartbeatCollector } from '../../collectors/heartbeat/process.mjs'

// Configuration stays on stdin; the actual product collector supplies its
// operating-system host identity and uses the real authenticated intake door.
if(process.argv[1]===new URL(import.meta.url).pathname) {
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

}

/** The real pinned collector runs generated configuration unchanged. Only its
 * host environment carries credentials; stop owns exactly this process. */
export async function integrationCollector({configuration,file,environment,secret,serviceSecret}) {
 const {spawn,execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{writeFile}=await import('node:fs/promises')
 const {acquireCollector}=await import('../../collectors/sampling/release.mjs'),{privateProcessEnvironment}=await import('../../collectors/splunk/process.mjs')
 const binary=await acquireCollector(),env={...privateProcessEnvironment(),...environment,GOMAXPROCS:'2',PORTHOLE_INGEST_TOKEN:secret}
 await writeFile(file,JSON.stringify(configuration),{mode:0o600})
 await promisify(execFile)(binary,['validate','--config',file],{env})
 const child=spawn(binary,['--config',file],{env,stdio:['ignore','pipe','pipe']})
 let output='';const capture=part=>output=(output+part).split(secret).join('[REDACTED]').split(serviceSecret).join('[REDACTED]').slice(-12000)
 child.stdout.on('data',capture);child.stderr.on('data',capture)
 const exited=new Promise(resolve=>child.once('exit',resolve)),hard=setTimeout(()=>child.kill('SIGKILL'),180000)
 return {child,diagnostics:()=>output,stop:async()=>{clearTimeout(hard);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(timer)}}}
}
