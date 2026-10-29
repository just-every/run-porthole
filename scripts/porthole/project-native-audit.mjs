import {readFile,writeFile,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {parseJsonc} from '@runeditrun/rer/jsonc'
import {getPlatformProxy} from 'wrangler'
import {append} from '../../src/porthole/audit/store.ts'
import {projectFacts} from '../../src/porthole/audit/facts.ts'

// Successful transfers project after migrations under the local operation lock.
// Open data bindings only: no application session or provider key is loaded.
const root=process.cwd(),config=parseJsonc(await readFile(join(root,'wrangler.jsonc'),'utf8'))
const path=join(root,'.wrangler',`porthole-audit-${process.pid}.json`)
await mkdir(join(root,'.wrangler'),{recursive:true})
await writeFile(path,JSON.stringify(Object.fromEntries(['name','compatibility_date','compatibility_flags','d1_databases','r2_buckets'].filter(key=>config[key]!==undefined).map(key=>[key,config[key]]))),{mode:0o600})
let proxy
try {
 proxy=await getPlatformProxy({configPath:path,persist:{path:join(root,'.wrangler/state/v3')},remoteBindings:false})
 const event=process.argv[2]?JSON.parse(process.argv[2]):undefined
 if(event && event.kind!=='snapshot-actors' && (!/^[a-f0-9-]{36}$/.test(event.operationRef)||!['export','import'].includes(event.kind)||!['succeeded','failed'].includes(event.phase)||!Number.isSafeInteger(event.occurredAt)))throw Error('invalid_native_audit_event')
 // Base verifies an import before applying migrations. A refused archive can
 // therefore leave an empty destination with no audit schema. Preserve that
 // original refusal instead of replacing it with a missing-table error.
 const uninitialized=event?.kind==='import' && event.phase==='failed' && !await proxy.env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='porthole_audit_facts'").first()
 if(uninitialized)console.log('Native import refused before audit schema initialization.')
 else {
 await projectFacts(proxy.env.DB)
 if(event) {
  if(event.kind==='snapshot-actors') {
   await proxy.env.DB.prepare("INSERT INTO porthole_archive_health_history(stream,table_name,row_key,row,state) SELECT ?, 'porthole_analytical_configuration','[1]',json_object('singleton',singleton,'source_identity',source_identity,'enabled',enabled,'active_role',active_role,'revision',revision,'changed_at',changed_at,'configured_by',configured_by,'configurer_revision',configurer_revision,'configurer_version',configurer_version),'quarantined' FROM porthole_analytical_configuration").bind(crypto.randomUUID()).run()
   for(const [table,columns,keys=['id']]of [
    ['porthole_host_sources',['credential_id','collector_id','team','service','environment','signal','host_id','first_at','last_at'],['credential_id','collector_id','team','service','environment','signal']],
    ['porthole_host_heartbeats',['id','credential_id','collector_id','team','service','environment','signal','host_id','observed_at']],
    ['porthole_host_monitor_state',['object_id','revision','host_id','evaluated_at','evidence'],['object_id','host_id']],
    ['porthole_follow_up',['id','source','kind','scope','owner_id','state','reason','next_action','due_at','guard_id','guard_revision','generation','revision','reminders','suppressed_until','created_at','updated_at']],
    ['porthole_follow_up_events',['id','task_id','generation','kind','actor_id','detail','occurred_at']],
   ])await proxy.env.DB.prepare(`INSERT INTO porthole_archive_health_history(stream,table_name,row_key,row,state) SELECT ?,?,json_array(${keys.join(',')}),json_object(${columns.map(column=>"'"+column+"',"+column).join(',')}),'quarantined' FROM ${table}`).bind(crypto.randomUUID(),table).run()
   await proxy.env.DB.prepare("INSERT INTO porthole_archive_actors(actor_ref,role,scope,state) SELECT operator_id,role,scope,'inactive' FROM porthole_members WHERE 1 ON CONFLICT(actor_ref) DO UPDATE SET role=excluded.role,scope=excluded.scope").run()
  } else {
  const actor=await proxy.env.DB.prepare("SELECT id,version FROM oa_operators WHERE role='owner' AND status='active' ORDER BY created_at,id LIMIT 1").first()
  const input={operationRef:event.operationRef,actorRef:actor?.id??null,actorRevision:actor?.version??null,action:`installation.${event.kind}.command`,entityRef:null,revision:null,occurredAt:event.occurredAt,status:null}
  await append(proxy.env.DB,{...input,phase:'attempted'})
  await append(proxy.env.DB,{...input,phase:event.phase})
  }
 }
 console.log('Private archive audit projected.')
 }
} finally {await proxy?.dispose();await rm(path,{force:true})}
