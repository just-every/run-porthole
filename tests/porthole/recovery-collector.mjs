import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {acquireCollector} from '../../collectors/sampling/release.mjs'
import {freePort,until,privateProcessEnvironment} from '../../collectors/splunk/process.mjs'

/** Stock OTel exporter queue, persisted outside either installation. Only the
 * owner-selected destination and private credential change after the outage. */
export async function recoveryCollector(directory){
 const binary=await acquireCollector(),port=await freePort(),healthPort=await freePort(),queue=join(directory,'queue'),config=join(directory,'collector.yaml')
 await mkdir(queue,{recursive:true})
 await writeFile(config,`extensions:
  health_check:
    endpoint: 127.0.0.1:${healthPort}
  file_storage/recovery:
    directory: ${queue}
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:${port}
exporters:
  otlphttp:
    endpoint: \${env:PORTHOLE_COLLECTOR_DESTINATION}
    headers:
      Authorization: \${env:PORTHOLE_COLLECTOR_AUTHORIZATION}
    encoding: json
    compression: none
    timeout: 2s
    sending_queue:
      enabled: true
      storage: file_storage/recovery
      num_consumers: 1
      queue_size: 100
    retry_on_failure:
      enabled: true
      initial_interval: 100ms
      max_interval: 1s
      max_elapsed_time: 0s
service:
  extensions: [health_check, file_storage/recovery]
  telemetry:
    logs:
      level: error
    metrics:
      level: none
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
`)
 let child,output=''
 const stop=async()=>{if(child?.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited}child=null}
 const start=async(origin,secret)=>{
  child=spawn(binary,['--config='+config],{env:{...privateProcessEnvironment(),GOMAXPROCS:'2',PORTHOLE_COLLECTOR_DESTINATION:origin,PORTHOLE_COLLECTOR_AUTHORIZATION:'Bearer '+secret},stdio:['ignore','pipe','pipe']})
  const capture=chunk=>output=(output+chunk).slice(-4000);child.stdout.on('data',capture);child.stderr.on('data',capture)
  await until(async()=>{if(child.exitCode!==null)throw Error('Recovery collector exited: '+output.split(secret).join('[redacted]'));return fetch('http://127.0.0.1:'+healthPort).then(row=>row.ok).catch(()=>false)},'stock recovery collector readiness')
 }
 return {start,stop,origin:'http://127.0.0.1:'+port,alive:()=>child?.exitCode===null&&child.signalCode===null}
}
