// Shared rer export/import uses the same inactive custody boundary as Settings.
// Native identities become opaque inactive records; sessions and credentials
// are omitted entirely, including hashes. Source ids remain audit references.
const excluded=[
 'rer_dependency_%','oc_%','porthole_credentials','porthole_object_approvals',
 'porthole_audit_context','porthole_audit_facts','porthole_archive_jobs',
 'porthole_archive_rows','porthole_archive_chunks','porthole_transaction_guard',
 'porthole_health_collectors','porthole_health_configuration','porthole_health_incidents','porthole_health_notices',
]
export default {
 product:'just-every/porthole',
 includeTables:['oa_operators','porthole_members','porthole_membership_migration'],
 excludeTables:excluded,
 requiredConfiguration:['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','AUTH_ORIGIN','MAIL_PROVIDER','MAIL_FROM'],
 exportRow(table,row) {
  if(table==='oa_operators')return {...row,email:`${row.id}@archived.invalid`,display_name:'Archived actor',status:'inactive',last_signin_at:null}
  return row
 },
 importSafety:{
  oa_operators:{status:['inactive']},porthole_objects:{state:['quarantined']},
  porthole_ingest_control:{paused:[1]},porthole_health_receipts:{status:['Unknown'],expires_at:[0]},
  porthole_monitor_state:{status:['Unknown']},
 },
 importRow(table,row) {
  if(table==='oa_operators')return {...row,status:'inactive'}
  if(table==='porthole_objects')return {...row,state:'quarantined'}
  if(table==='porthole_ingest_control')return {...row,paused:1}
  if(table==='porthole_health_receipts')return {...row,status:'Unknown',expires_at:0}
  if(table==='porthole_monitor_state')return {...row,status:'Unknown'}
  return row
 },
 async validateStaged({db,tables}) {
  // Database constraints and the shared portability semantic validator enforce
  // row types/foreign keys; this independent condition forbids active identities.
  const operators=tables.oa_operators
  if(!operators)return false
  const quote=value=>'"'+value.replaceAll('"','""')+'"'
  const row=await db.prepare(`SELECT COUNT(*) AS n FROM ${quote(operators)} WHERE status!='inactive'`).first()
  return row.n===0
 },
}
