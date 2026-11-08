// The reporter observes this node only. No credential enters reports or logs.
import {readFile,readdir,access} from 'node:fs/promises'
import {request} from 'node:https'
import {release} from 'node:os'
const env=process.env,sa='/var/run/secrets/kubernetes.io/serviceaccount/'
const capabilities={CAP_BPF:39,CAP_PERFMON:38,CAP_SYS_PTRACE:19,CAP_DAC_READ_SEARCH:2,CAP_NET_RAW:13,CAP_CHECKPOINT_RESTORE:40}
const requested=['host-proc','host-sys','container-logs','kubernetes-rbac','host-pid','btf','tracefs','cgroup',...Object.keys(capabilities)]
async function exists(path){try{await access(path);return true}catch{return false}}
async function kube(path) {
 const token=(await readFile(sa+'token','utf8')).trim(),ca=await readFile(sa+'ca.crt')
 return new Promise((resolve,reject)=>{const r=request({hostname:env.KUBERNETES_SERVICE_HOST,port:Number(env.KUBERNETES_SERVICE_PORT_HTTPS??443),path,ca,headers:{authorization:'Bearer '+token},timeout:5000},s=>{s.resume();s.on('end',()=>resolve(s.statusCode===200))});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('kubernetes_timeout')));r.end()})
}
let sequence=Date.now(),stop=false
process.on('SIGTERM',()=>{stop=true});process.on('SIGINT',()=>{stop=true})
async function report(state) {
 const granted=[]
 for(const [name,path]of [['host-proc','/hostfs/proc/1/status'],['host-sys','/hostfs/sys/kernel'],['container-logs','/var/log/pods'],['btf','/hostfs/sys/kernel/btf/vmlinux'],['tracefs','/hostfs/tracefs/available_events'],['cgroup','/hostfs/cgroup/cgroup.controllers']])if(await exists(path))granted.push(name)
 let cap=0n,found=false
 for(const pid of (await readdir('/proc')).filter(s=>/^\d+$/.test(s)))try{
  const cmd=await readFile('/proc/'+pid+'/comm','utf8')
  if(/^(obi|ebpf-instrument)/.test(cmd)){const status=await readFile('/proc/'+pid+'/status','utf8'),m=status.match(/^CapEff:\s*([0-9a-f]+)/m);cap|=BigInt('0x'+(m?.[1]??'0'));found=true}
 }catch{}
 if(found)granted.push('host-pid')
 for(const [name,bit]of Object.entries(capabilities))if(cap&(1n<<BigInt(bit)))granted.push(name)
 try{if((await Promise.all(['/api/v1/pods?limit=1','/api/v1/namespaces?limit=1','/api/v1/nodes?limit=1','/api/v1/services?limit=1','/apis/apps/v1/replicasets?limit=1'].map(kube))).every(Boolean))granted.push('kubernetes-rbac')}catch{}
 const token=(await readFile('/run/secrets/porthole/token','utf8')).trim()
 const body={id:env.PORTHOLE_RELEASE+'-'+env.K8S_NODE_NAME,service:env.PORTHOLE_SERVICE,environment:env.PORTHOLE_ENVIRONMENT,team:env.PORTHOLE_TEAM,state,report:{platform:'kubernetes',node:env.K8S_NODE_NAME,kernel:release(),runtime:'kubernetes',collectorVersion:'0.135.0',obiVersion:'1.0.0',requested,granted,limits:['linux-only','kernel-btf-required','kernel-5.8-or-newer','supported-runtime-required','bounded-memory-queue','no-go-context-injection-without-sys-admin'],services:[],obi:found?'starting':'unavailable',sequence:++sequence}}
 const response=await fetch(new URL('/api/porthole/v1/fleet/report',env.PORTHOLE_ENDPOINT),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw Error('fleet_report_refused_'+response.status)
}
while(!stop){try{await report('active')}catch{console.error('Fleet observation refused or unavailable; check credential, scope and connection.')}await new Promise(r=>setTimeout(r,15000))}
await report('stopped').catch(()=>{})
