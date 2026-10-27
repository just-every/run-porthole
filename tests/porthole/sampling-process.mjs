import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {acquireCollector} from '../../collectors/sampling/release.mjs'
import {freePort,until,privateProcessEnvironment} from '../../collectors/splunk/process.mjs'
export async function startSamplingCollector({origin,secret}) {
 const binary=await acquireCollector(),port=await freePort(),healthPort=await freePort()
 const child=spawn(binary,['--config=collectors/sampling/collector.yaml'],{env:{...privateProcessEnvironment(),GOMAXPROCS:'2',PORTHOLE_COLLECTOR_LISTEN:'127.0.0.1:'+port,PORTHOLE_COLLECTOR_HEALTH_LISTEN:'127.0.0.1:'+healthPort,PORTHOLE_COLLECTOR_DESTINATION:origin,PORTHOLE_COLLECTOR_AUTHORIZATION:'Bearer '+secret},stdio:['ignore','pipe','pipe']})
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b)
 const exited=once(child,'exit'),hard=setTimeout(()=>child.kill('SIGKILL'),180000)
 async function stop(){clearTimeout(hard);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await exited}}
 try{
  await until(async()=>{if(child.exitCode!==null)throw Error('Stock collector launch failed: '+output.split(secret).join('[redacted]'));return fetch('http://127.0.0.1:'+healthPort,{signal:AbortSignal.timeout(1000)}).then(r=>r.ok).catch(()=>false)},'Stock collector readiness')
  return {origin:'http://127.0.0.1:'+port,stop}
 }catch(error){await stop();throw error}
}
