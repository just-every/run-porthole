import {fail} from '../security/authority'
export const fleetColumns=['id','service','environment','team','report','observed_at','state']
export const requirements={docker:['root-user','host-proc','host-sys','container-logs','docker-socket'],kubernetes:['host-proc','host-sys','container-logs','kubernetes-rbac','host-pid','CAP_BPF','CAP_PERFMON','CAP_SYS_PTRACE','CAP_DAC_READ_SEARCH','CAP_NET_RAW','CAP_CHECKPOINT_RESTORE','btf','tracefs','cgroup']} as const
export interface InstallReport {
 platform:'docker'|'kubernetes'; node:string; kernel:string; runtime:string; collectorVersion:string; obiVersion:string|null
 requested:string[]; granted:string[]; limits:string[]; services:string[]; obi:'not-installed'|'starting'|'observed'|'unavailable'; sequence:number
}
const name=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(v)
export function installReport(value:unknown):InstallReport {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_install_report',400)
 const v=value as InstallReport
 if(Object.keys(v).sort().join(',')!==['platform','node','kernel','runtime','collectorVersion','obiVersion','requested','granted','limits','services','obi','sequence'].sort().join(','))fail('invalid_install_report',400)
 if(!['docker','kubernetes'].includes(v.platform)||![v.node,v.kernel,v.runtime,v.collectorVersion].every(name)||v.obiVersion!==null&&!name(v.obiVersion)||!['not-installed','starting','observed','unavailable'].includes(v.obi)||!Number.isSafeInteger(v.sequence)||v.sequence<1)fail('invalid_install_report',400)
 for(const key of ['requested','granted','limits','services'] as const)if(!Array.isArray(v[key])||v[key].length>100||v[key].some(s=>!name(s))||new Set(v[key]).size!==v[key].length)fail('invalid_install_report',400)
 const allowed=[...requirements.docker,...requirements.kubernetes] as readonly string[]
 if([...v.requested,...v.granted].some(s=>!allowed.includes(s))||v.granted.some(s=>!v.requested.includes(s)))fail('invalid_install_privileges',400)
 return v
}
const actions:Record<string,string>={
 'root-user':'Review the root user needed for local container logs, without additional capabilities.', 'host-proc':'Restore the read-only host proc mount.', 'host-sys':'Restore the read-only host sys mount.', 'container-logs':'Restore the read-only container log mount.', 'docker-socket':'Review and restore Docker socket access; it grants host control even when mounted read-only.', 'kubernetes-rbac':'Restore the documented get, list and watch rules for pods, namespaces and nodes.', 'host-pid':'Review and enable host PID discovery.', 'CAP_BPF':'Review and grant BPF capability.', 'CAP_PERFMON':'Review and grant performance monitoring capability.', 'CAP_SYS_PTRACE':'Review and grant process tracing capability.', 'CAP_DAC_READ_SEARCH':'Review and grant process metadata access.', btf:'Use a supported Linux kernel with readable BTF.', tracefs:'Restore the reviewed trace filesystem mount.', cgroup:'Restore the reviewed cgroup filesystem mount.', CAP_NET_RAW:'Review and grant raw network socket capability.', CAP_CHECKPOINT_RESTORE:'Review and grant executable inspection capability.',
}
export function gaps(v:InstallReport) {
 return [...new Set([...requirements[v.platform],...v.requested])].filter(p=>!v.granted.includes(p)).map(code=>({code,action:actions[code]})).concat(v.platform==='kubernetes'&&v.obi!=='observed'?[{code:'obi-no-observed-spans',action:'Inspect OBI logs, supported runtime and real traffic; privileges alone do not prove coverage.'}]:[])
}
export function validateFleetRow(row:Record<string,unknown>) {
 if(typeof row.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(row.id)||!['service','environment','team'].every(k=>name(row[k]))||typeof row.report!=='string'||!Number.isSafeInteger(row.observed_at)||Number(row.observed_at)<0||!['active','stopped','quarantined'].includes(String(row.state)))fail('archive_semantics_invalid',422)
 installReport(JSON.parse(row.report))
}
