#!/usr/bin/env node
import {readFile,writeFile,mkdir,stat,chmod} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {resolve,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {request as httpsRequest} from 'node:https'
import {request as httpRequest} from 'node:http'
import {hostname,release} from 'node:os'
import {setTimeout as pause} from 'node:timers/promises'
import {collectorImage,version} from './release.mjs'
const execute=promisify(execFile),here=dirname(fileURLToPath(import.meta.url))
export async function configuration(file,{localTest=false}={}) {
 const info=await stat(file)
 if(!info.isFile()||(info.mode&0o077)!==0)throw Error('credential_file_requires_mode_0600')
 const values={}
 for(const line of (await readFile(file,'utf8')).split('\n')){if(!line||line.startsWith('#'))continue;const i=line.indexOf('=');if(i<1)throw Error('invalid_env_file');values[line.slice(0,i)]=line.slice(i+1)}
 for(const key of ['PORTHOLE_INSTALL_ID','PORTHOLE_SERVICE','PORTHOLE_ENVIRONMENT','PORTHOLE_TEAM'])if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(values[key]??''))throw Error('invalid_install_scope')
 let endpoint
 try{endpoint=new URL(values.PORTHOLE_ENDPOINT)}catch{throw Error('https_origin_required')}
 if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/'||endpoint.protocol!=='https:'&&!(localTest&&endpoint.protocol==='http:'))throw Error('https_origin_required')
 if(!values.PORTHOLE_INGEST_TOKEN&&!values.PORTHOLE_SECRET_FILE)throw Error('ingest_credential_file_required')
 if(values.PORTHOLE_INGEST_TOKEN&&values.PORTHOLE_SECRET_FILE)throw Error('choose_one_credential_file')
 if(values.PORTHOLE_SECRET_FILE){const info=await stat(values.PORTHOLE_SECRET_FILE);if(!info.isFile()||(info.mode&0o077)!==0)throw Error('credential_file_requires_mode_0600')}
 return values
}
const docker=async(args,env)=>(await execute('docker',args,{maxBuffer:1024*1024,...(env?{env:{...process.env,...env}}:{})})).stdout
export async function observe(name,config,sequence,state='active',{signal}={}) {
 let inspect
 try{inspect=JSON.parse(await docker(['inspect',name]))[0]}catch{throw Error('collector_inspection_unavailable')}
 const mounts=inspect.Mounts??[],granted=[]
 if(mounts.some(m=>m.Type==='volume'&&m.Destination==='/var/lib/porthole'&&m.RW))granted.push('offset-state')
 if(inspect.Config.User==='0:0')granted.push('root-user')
 const requested=['root-user','host-proc','host-sys','container-logs','docker-socket','offset-state']
 if(config.PORTHOLE_SECRET_FILE){requested.push('CAP_DAC_READ_SEARCH');if((inspect.HostConfig.CapAdd??[]).some(c=>['DAC_READ_SEARCH','CAP_DAC_READ_SEARCH'].includes(c)))granted.push('CAP_DAC_READ_SEARCH')}
 for(const [cap,path]of [['host-proc','/hostfs/proc'],['host-sys','/hostfs/sys'],['container-logs','/var/lib/docker/containers'],['docker-socket','/var/run/docker.sock']])if(mounts.some(m=>m.Destination===path&&m.RW===false))granted.push(cap)
 // Mount presence is separate from the actual socket read. Never call the
 // container's privilege grant healthy when its socket is absent or refused.
 if(granted.includes('docker-socket'))try{await docker(['stats','--no-stream','--format','{{.ID}}',name])}catch{granted.splice(granted.indexOf('docker-socket'),1)}
 const engine=(await docker(['version','--format','{{.Server.Version}}'])).trim()
 const resourceLimits=[inspect.HostConfig.Memory?'memory-bytes-'+inspect.HostConfig.Memory:'memory-unlimited',inspect.HostConfig.CpuQuota>0?'cpu-quota-'+inspect.HostConfig.CpuQuota:'cpu-quota-unlimited']
 const token=config.PORTHOLE_INGEST_TOKEN??(await readFile(config.PORTHOLE_SECRET_FILE,'utf8')).trim()
 const report={id:config.PORTHOLE_INSTALL_ID,service:config.PORTHOLE_SERVICE,environment:config.PORTHOLE_ENVIRONMENT,team:config.PORTHOLE_TEAM,state:state==='stopped'||!inspect.State.Running?'stopped':'active',report:{collector:inspect.State.Running?'running':inspect.State.ExitCode?'failed':'stopped',platform:'docker',node:hostname(),kernel:release(),runtime:'docker-'+engine,collectorVersion:version,obiVersion:null,requested,granted,limits:[...resourceLimits,'linux-only','docker-json-file-logs','bounded-persistent-queue','no-ebpf-in-docker-install'],services:[],obi:'not-installed',sequence}}
 const url=new URL('/api/porthole/v1/fleet/report',config.PORTHOLE_ENDPOINT),body=JSON.stringify(report),ca=config.PORTHOLE_CA_FILE?await readFile(config.PORTHOLE_CA_FILE):undefined
 const receipt=await new Promise((resolve,reject)=>{
  const outgoing=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'POST',signal,...(ca?{ca}:{}),headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{
   const chunks=[];let size=0
   response.on('data',chunk=>{size+=chunk.length;if(size>16384)outgoing.destroy(Error('fleet_response_too_large'));else chunks.push(chunk)})
   response.on('error',()=>reject(Error('fleet_response_failed')))
   response.on('end',()=>{
    if(response.statusCode!==200){
     const status=response.statusCode,error=Error('fleet_report_refused_'+status)
     // A sequence conflict after a lost acknowledgement is retried with a new
     // observation. Authentication, scope and target errors need owner repair.
     error.permanent=status>=400&&status<500&&![408,409,425,429].includes(status)
     if([429,503].includes(status)){
      const value=response.headers['retry-after']
      const until=/^\d+$/.test(value??'')?Date.now()+Number(value)*1000:Date.parse(value)
      if(Number.isFinite(until))error.retryAfter=Math.max(0,until-Date.now())
     }
     return reject(error)
    }
    try{resolve(JSON.parse(Buffer.concat(chunks)))}catch{reject(Error('fleet_response_invalid'))}
   })
  })
  // Bound the whole request, including a slow response body, not just socket
  // inactivity. A timeout must never escape as a fatal installer error.
  const deadline=setTimeout(()=>outgoing.destroy(Error('fleet_timeout')),10000)
  outgoing.on('close',()=>clearTimeout(deadline))
  outgoing.on('error',error=>{
   const failure=Error(error.message==='fleet_timeout'?'fleet_timeout':'fleet_listener_unavailable')
   if(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code)){
    failure.message='fleet_tls_configuration_invalid';failure.permanent=true
   }
   reject(failure)
  })
  outgoing.end(body)
 })
 return {report,receipt}

}
export async function install(file,{localTest=false,name,configPath=resolve(here,'config.yaml'),omit=[]}={}) {
 const config=await configuration(file,{localTest}),id=config.PORTHOLE_INSTALL_ID
 name??='porthole-'+id
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name))throw Error('invalid_container_name')
 let settings=await readFile(configPath,'utf8')
 const state=resolve('.cache/collector',id);await mkdir(state,{recursive:true,mode:0o700})
 const flags=['create','--name',name,'--restart','unless-stopped','--user','0:0','--cap-drop','ALL','--security-opt','no-new-privileges','--env-file',resolve(file),'--label','porthole.install='+id]
 const localProxy={}
 for(const key of ['NO_PROXY','no_proxy'])if(config[key]){localProxy[key]=config[key];flags.push('--env',key)}
 if(config.PORTHOLE_SECRET_FILE){flags.push('--cap-add','DAC_READ_SEARCH');settings=settings.replace('token: ${env:PORTHOLE_INGEST_TOKEN}','filename: /run/secrets/porthole_ingest');flags.push('--mount','type=bind,src='+resolve(config.PORTHOLE_SECRET_FILE)+',dst=/run/secrets/porthole_ingest,readonly')}
 if(config.PORTHOLE_CA_FILE){
  const ca=await readFile(config.PORTHOLE_CA_FILE,'utf8')
  if(!ca.includes('-----BEGIN CERTIFICATE-----')||ca.includes('PRIVATE KEY'))throw Error('invalid_ca_certificate')
  await writeFile(state+'/ca.pem',ca,{mode:0o644});await chmod(state+'/ca.pem',0o644)
  settings=settings.replace('    endpoint: ${env:PORTHOLE_ENDPOINT}','    endpoint: ${env:PORTHOLE_ENDPOINT}\n    tls:\n      ca_file: /etc/porthole-ca.pem');flags.push('--mount','type=bind,src='+state+'/ca.pem,dst=/etc/porthole-ca.pem,readonly')
 }
 await writeFile(state+'/config.yaml',settings,{mode:0o644});await chmod(state+'/config.yaml',0o644)
 flags.push('--mount','type=bind,src='+state+'/config.yaml,dst=/etc/otelcol-contrib/config.yaml,readonly')
 for(const [key,src,dst]of [['host-proc','/proc','/hostfs/proc'],['host-sys','/sys','/hostfs/sys'],['container-logs','/var/lib/docker/containers','/var/lib/docker/containers'],['docker-socket','/var/run/docker.sock','/var/run/docker.sock']])if(!omit.includes(key))flags.push('--mount','type=bind,src='+src+',dst='+dst+',readonly')
 if(!omit.includes('offset-state'))flags.push('--mount','type=volume,src=porthole-state-'+id+',dst=/var/lib/porthole')
 flags.push(collectorImage,'--config=/etc/otelcol-contrib/config.yaml')
 const containerId=(await docker(flags,localProxy)).trim()
 if(!/^[a-f0-9]{64}$/.test(containerId))throw Error('collector_identity_unavailable')
 settings=settings.replace('    include: [/var/lib/docker/containers/*/*.log]','    include: [/var/lib/docker/containers/*/*.log]\n    exclude: [/var/lib/docker/containers/'+containerId+'/*.log]')
 await writeFile(state+'/config.yaml',settings,{mode:0o644})
 await docker(['start',name])
 return {name,config,state}
}
// Retry forever while collection is active; the delay, request lifetime and
// Collector queue are bounded. No report payloads accumulate in the installer.
export async function watchFleet(name,config,{signal,onObservation=()=>{},onRetry=()=>{}}={}) {
 let sequence=Date.now(),failures=0
 const wait=async milliseconds=>{
  // Node timers overflow after ~24 days; honor even long Retry-After values in
  // interruptible chunks rather than accidentally retrying immediately.
  const until=Date.now()+milliseconds
  while(!signal?.aborted&&Date.now()<until)await pause(Math.min(until-Date.now(),2147483647),undefined,{signal})
 }
 try {
  while(!signal?.aborted){
   try {
    const result=await observe(name,config,++sequence,'active',{signal})
    failures=0;onObservation(result)
    if(result.report.state==='stopped')return
   } catch(error) {
    if(signal?.aborted)return
    if(error.permanent)throw error
    const ceiling=Math.min(30000,1000*2**Math.min(failures++,5))
    const delay=Math.max(ceiling*(0.5+Math.random()*0.5),error.retryAfter??0)
    onRetry(Math.ceil(delay))
    await wait(delay);continue
   }
   await wait(15000)
  }
 } catch(error) {if(!signal?.aborted)throw error}
}
async function main() {
 const [verb,...args]=process.argv.slice(2),at=args.indexOf('--env-file'),file=at<0?null:args[at+1]
 if(!file||!['install','uninstall'].includes(verb))throw Error('usage_install_or_uninstall_with_env_file')
 const config=await configuration(file),name='porthole-'+config.PORTHOLE_INSTALL_ID
 if(verb==='uninstall'){await docker(['stop','--time','10',name]);console.log('Collector stopped. Retained telemetry is unchanged. The running installer records a stopped observation.');return}
 const started=await install(file),controller=new AbortController()
 const stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop)
 try{
  console.log('Collector started. Keep this installer running for fleet observations; use the uninstall command to stop collection.')
  await watchFleet(name,config,{signal:controller.signal,onObservation:result=>console.log('Fleet observation accepted: '+result.report.state),onRetry:delay=>console.error('Fleet observation unavailable; Collector remains running. Retrying in '+delay+' ms.')})
 }finally{await docker(['stop','--time','10',started.name]).catch(()=>{});await observe(name,config,Date.now()+1,'stopped').catch(()=>{});process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{const code=/^(fleet_report_refused_[0-9]{3}|fleet_tls_configuration_invalid|credential_file_requires_mode_0600|https_origin_required|ingest_credential_file_required|invalid_install_scope|choose_one_credential_file|fleet_listener_unavailable)$/.test(error.message)?error.message:'installation_unavailable';console.error('Collector installation stopped: '+code+'. Check Docker, private credential file, scope and connectivity.');process.exitCode=1})
