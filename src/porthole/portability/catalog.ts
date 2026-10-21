/** This is a closed product schema, not a database dump. Adding a domain table
 * requires an explicit projection and semantic validator here. Auth, provider
 * settings, credentials, approval grants and outboxes are deliberately absent. */
export interface TableSpec { table: string; columns: string[]; query: string; order: string }
const spec = (table: string, columns: string[], order: string): TableSpec => ({ table, columns, order, query: `SELECT ${columns.join(',')} FROM ${table}` })
export const catalog: TableSpec[] = [
 spec('porthole_objects',['id','kind','name','scope','body','revision','state','created_at','updated_at'],'id'),
 spec('porthole_archive_quarantine',['object_id','source_state','archive_id','restored_at','collection','schedules','delivery','execution','leases'],'object_id'),
 {table:'porthole_archive_actors',columns:['actor_ref','role','scope','state'],order:'actor_ref',query:`SELECT operator_id AS actor_ref,role,scope,'inactive' AS state FROM porthole_members UNION SELECT actor_ref,role,scope,state FROM porthole_archive_actors WHERE actor_ref NOT IN (SELECT operator_id FROM porthole_members)`},
 spec('porthole_query_snapshots',['id','actor_ref','scope','signal','from_ns','through_ns','through_batch','created_at'],'id'),
 spec('porthole_erased_actors',['actor_ref','erased_at'],'actor_ref'),
 {table:'porthole_archive_audit',columns:['stream','sequence','event_id','previous_hash','hash','entry'],order:'stream,sequence',query:''},
 spec('porthole_ingest_control',['singleton','paused','max_pending_bytes','revision','changed_at'],'singleton'),
 spec('porthole_ingest_batches',['id','sequence','source_id','signal','identity','digest','protocol','accepted_at','byte_count','record_count','wire_base64','records','state','completed_at','completion_sequence'],'sequence'),
 spec('porthole_telemetry_records',['id','batch_id','ordinal','source_id','signal','team','service','environment','event_time_ns','trace_id','span_id','payload','indexed_at','late','out_of_order'],'batch_id,ordinal'),
 spec('porthole_telemetry_archive',['id','batch_id','ordinal','source_id','signal','team','service','environment','event_time_ns','trace_id','span_id','payload','archived_at'],'batch_id,ordinal'),
 spec('porthole_ingest_events',['id','source_id','signal','team','service','environment','occurred_at','kind','reason','record_count','batch_ref','range_start_ns','range_end_ns'],'id'),
]
export const byTable = new Map(catalog.map(value => [value.table,value]))
export function snapshotQuery(item: TableSpec, stream: string): string {
 const query = item.table==='porthole_archive_audit' ? `SELECT '${stream}' AS stream,sequence,event_id,previous_hash,hash,entry FROM porthole_audit_entries UNION ALL SELECT stream,sequence,event_id,previous_hash,hash,entry FROM porthole_archive_audit` : item.table==='porthole_ingest_batches' ? `SELECT ${item.columns.map(column=>column==='wire_base64'?"'' AS wire_base64":column).join(',')} FROM porthole_ingest_batches` : item.query
 return `SELECT json_object('table','${item.table}','row',json_object(${item.columns.map(column => `'${column}',${column}`).join(',')})) AS payload FROM (${query}) ORDER BY ${item.order}`
}
export const emptyProduct = `NOT EXISTS(SELECT 1 FROM porthole_query_snapshots) AND NOT EXISTS(SELECT 1 FROM porthole_objects) AND NOT EXISTS(SELECT 1 FROM porthole_archive_actors) AND NOT EXISTS(SELECT 1 FROM porthole_archive_audit) AND NOT EXISTS(SELECT 1 FROM porthole_ingest_batches) AND NOT EXISTS(SELECT 1 FROM porthole_telemetry_records) AND NOT EXISTS(SELECT 1 FROM porthole_telemetry_archive) AND NOT EXISTS(SELECT 1 FROM porthole_ingest_events)`
