import {publicationColumns} from '../notebooks/publication-model'
import {columns as notebookColumns} from '../notebooks/model'
import { healthHistoryQuery } from './health-history'
import { historyColumns } from '../storage/model'
import {custodyColumns,custodyQueries} from '../migration/custody/catalog'
import {emptyCustody} from '../migration/custody/boundary'
import {journalColumns} from '../migration/erasure/journal'
/** This is a closed product schema, not a database dump. Adding a domain table
 * requires an explicit projection and semantic validator here. Native auth, provider secrets, credential hashes and approval grants
 * are deliberately absent. Delivery history is inert, never a live outbox. */
export interface TableSpec { table: string; columns: string[]; query: string; order: string }
const spec = (table: string, columns: string[], order: string): TableSpec => ({ table, columns, order, query: `SELECT ${columns.join(',')} FROM ${table}` })
export const catalog: TableSpec[] = [
 spec('porthole_notebook_versions',notebookColumns,'id,revision'),
 spec('porthole_notebooks',notebookColumns,'id'),
 spec('porthole_notebook_publications',publicationColumns,'id'),
 spec('porthole_metric_rules',['id','revision','definition','from_sequence','created_at','owner_id','state'],'id,revision'),
 spec('porthole_metric_points',['rule_id','revision','batch_id','ordinal','dimensions','value','valid','event_time_ns','trace_id','span_id'],'rule_id,revision,batch_id,ordinal'),
 spec('porthole_migration_erasure_fences',journalColumns,'receipt_id'),
 spec('porthole_migration_records',['kind','id','body','revision'],'kind,id'),
 {table:'porthole_migration_custody',columns:custodyColumns,order:'stream,source_table,source_key',query:''},
 spec('porthole_slo_versions',['id','revision','name','definition','owner_id','created_at','state'],'id,revision'),
 spec('porthole_retention_policies',['id','selection','days','revision','changed_at','active'],'id'),
 spec('porthole_erased_batches',['id','content_digest','erased_at'],'id'),
 spec('porthole_export_exclusions',['record_id','excluded_at'],'record_id'),
 spec('porthole_baggage_policy',['singleton','enabled','allowed_keys','attribute_keys','revision','changed_at'],'singleton'),
 spec('porthole_bucket_history',historyColumns,'id'),
 spec('porthole_dashboard_publications',['id','dashboard_id','source_revision','owner_id','owner_revision','operator_version','projection','source_review','allowed_origins','expires_at','digest','state','revision','created_at','updated_at','approved_at','revoked_at'],'id'),
 spec('porthole_dashboard_versions',['id','name','scope','body','revision','state','created_at','updated_at'],'id,revision'),
 spec('porthole_dashboards',['id','name','scope','body','revision','state','created_at','updated_at'],'id'),
 spec('porthole_monitor_versions',['object_id','revision','name','scope','body','created_at'],'object_id,revision'),
 spec('porthole_objects',['id','kind','name','scope','body','revision','state','created_at','updated_at'],'id'),
 spec('porthole_archive_quarantine',['object_id','source_state','archive_id','restored_at','collection','schedules','delivery','execution','leases'],'object_id'),
 {table:'porthole_archive_actors',columns:['actor_ref','role','scope','state'],order:'actor_ref',query:`SELECT operator_id AS actor_ref,role,scope,'inactive' AS state FROM porthole_members UNION SELECT actor_ref,role,scope,state FROM porthole_archive_actors WHERE actor_ref NOT IN (SELECT operator_id FROM porthole_members)`},
 spec('porthole_query_snapshots',['id','actor_ref','scope','signal','from_ns','through_ns','through_batch','created_at'],'id'),
 spec('porthole_erased_actors',['actor_ref','erased_at'],'actor_ref'),
 {table:'porthole_archive_audit',columns:['stream','sequence','event_id','previous_hash','hash','entry'],order:'stream,sequence',query:''},
 {table:'porthole_archive_health_history',columns:['stream','table_name','row_key','row','state'],order:'stream,table_name,row_key',query:''},
 spec('porthole_monitor_evaluations',['id','object_id','revision','evaluated_at','window_start_ns','window_end_ns','status','observed_count','firing_episode','reason'],'evaluated_at,id'),
 spec('porthole_ingest_control',['singleton','paused','max_pending_bytes','revision','changed_at'],'singleton'),
 spec('porthole_ingest_batches',['id','sequence','source_id','signal','identity','digest','protocol','accepted_at','byte_count','record_count','wire_base64','records','state','completed_at','completion_sequence'],'sequence'),
 spec('porthole_telemetry_records',['id','batch_id','ordinal','source_id','signal','team','service','environment','event_time_ns','trace_id','span_id','payload','indexed_at','late','out_of_order'],'batch_id,ordinal'),
 spec('porthole_telemetry_archive',['id','batch_id','ordinal','source_id','signal','team','service','environment','event_time_ns','trace_id','span_id','payload','archived_at'],'batch_id,ordinal'),
 spec('porthole_ingest_events',['id','source_id','signal','team','service','environment','occurred_at','kind','reason','record_count','batch_ref','range_start_ns','range_end_ns'],'id'),
]
export const byTable = new Map(catalog.map(value => [value.table,value]))
export function snapshotQueries(item: TableSpec, stream: string): string[] {
 const query = item.table==='porthole_archive_audit' ? `SELECT '${stream}' AS stream,sequence,event_id,previous_hash,hash,entry FROM porthole_audit_entries UNION ALL SELECT stream,sequence,event_id,previous_hash,hash,entry FROM porthole_archive_audit` : item.table==='porthole_archive_health_history'?healthHistoryQuery(stream) : item.query
 return (item.table==='porthole_migration_custody'?custodyQueries(stream):[query]).map(query=>`SELECT json_object('table','${item.table}','row',json_object(${item.columns.map(column => `'${column}',${(item.table==='porthole_archive_health_history'&&['row','row_key'].includes(column)||item.table==='porthole_migration_custody'&&['source_key','body'].includes(column))?`CAST(${column} AS TEXT)`:column}`).join(',')})) AS payload FROM (${query}) ORDER BY ${item.order}`)
}
// The complete restore fence must also fit D1 expression depth after the
// native session and fresh-proof predicates are added to the transaction.
function allPredicates(clauses:string[]):string {
 if(clauses.length===1)return clauses[0]
 const middle=Math.floor(clauses.length/2)
 return `(${allPredicates(clauses.slice(0,middle))} AND ${allPredicates(clauses.slice(middle))})`
}
export const emptyProduct = allPredicates([emptyCustody,
 'NOT EXISTS(SELECT 1 FROM porthole_notebook_publications)',
 'NOT EXISTS(SELECT 1 FROM porthole_notebooks)',
 'NOT EXISTS(SELECT 1 FROM porthole_notebook_versions)',
 'NOT EXISTS(SELECT 1 FROM porthole_notebook_shares)',
 'NOT EXISTS(SELECT 1 FROM porthole_metric_rules)',
 'NOT EXISTS(SELECT 1 FROM porthole_metric_points)',
 'NOT EXISTS(SELECT 1 FROM porthole_slo_versions)',
 'NOT EXISTS(SELECT 1 FROM porthole_follow_up)',
 'NOT EXISTS(SELECT 1 FROM porthole_follow_up_events)',
 'NOT EXISTS(SELECT 1 FROM porthole_retention_policies)',
 'NOT EXISTS(SELECT 1 FROM porthole_baggage_policy WHERE changed_at!=0 OR enabled!=0)',
 'NOT EXISTS(SELECT 1 FROM porthole_dashboard_publications)',
 'NOT EXISTS(SELECT 1 FROM porthole_dashboards)',
 'NOT EXISTS(SELECT 1 FROM porthole_dashboard_versions)',
 'NOT EXISTS(SELECT 1 FROM ik_door_uploads)',
 'NOT EXISTS(SELECT 1 FROM ik_door_plans)',
 'NOT EXISTS(SELECT 1 FROM porthole_migration_records)',
 'NOT EXISTS(SELECT 1 FROM porthole_analytical_configuration WHERE changed_at!=0 OR enabled!=0)',
 'NOT EXISTS(SELECT 1 FROM porthole_bucket_history)',
 'NOT EXISTS(SELECT 1 FROM porthole_health_collectors)',
 'NOT EXISTS(SELECT 1 FROM porthole_health_notices)',
 'NOT EXISTS(SELECT 1 FROM porthole_health_incidents)',
 'NOT EXISTS(SELECT 1 FROM porthole_monitor_state)',
 'NOT EXISTS(SELECT 1 FROM porthole_monitor_versions)',
 'NOT EXISTS(SELECT 1 FROM porthole_monitor_runs)',
 'NOT EXISTS(SELECT 1 FROM porthole_health_configuration WHERE changed_at!=0 OR notices_enabled!=0 OR recipient IS NOT NULL OR configured_by IS NOT NULL)',
 'NOT EXISTS(SELECT 1 FROM porthole_archive_health_history)',
 'NOT EXISTS(SELECT 1 FROM porthole_monitor_evaluations)',
 'NOT EXISTS(SELECT 1 FROM porthole_query_snapshots)',
 'NOT EXISTS(SELECT 1 FROM porthole_objects)',
 'NOT EXISTS(SELECT 1 FROM porthole_archive_actors)',
 'NOT EXISTS(SELECT 1 FROM porthole_archive_audit)',
 'NOT EXISTS(SELECT 1 FROM porthole_ingest_batches)',
 'NOT EXISTS(SELECT 1 FROM porthole_telemetry_records)',
 'NOT EXISTS(SELECT 1 FROM porthole_telemetry_archive)',
 'NOT EXISTS(SELECT 1 FROM porthole_ingest_events)',
])
