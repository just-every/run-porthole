import {createHash} from 'node:crypto'
import {readFile,stat} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {fingerprint,structuralPlan,reviewedPlans} from '../../src/porthole/database/sql.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex')
const denied=error=>['42501','28P01','28000','42000','ER_TABLEACCESS_DENIED_ERROR','ER_SPECIFIC_ACCESS_DENIED_ERROR','ER_ACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR'].includes(error?.code)||[1044,1045,1142,1227].includes(error?.errno)?'privilege_denied':'unavailable'
const trace=value=>{const match=/^00-([a-f0-9]{32})-([a-f0-9]{16})-01$/.exec(String(value??''));return {traceId:match?.[1]??null,spanId:match?.[2]??null}}
export const planDigest=plans=>hash(JSON.stringify(reviewedPlans(plans)))
export async function collect(config){
 if(!['postgresql','mysql'].includes(config.engine)||!['127.0.0.1','localhost','::1'].includes(config.connection?.host))throw Error('local_database_configuration_required')
 const plans=reviewedPlans(config.plans),capture={engine:config.engine,version:'unavailable',collectedAt:Date.now(),databaseTime:0,coverage:{statistics:'unavailable',plans:plans.length?'unavailable':'not_reviewed',waits:'unavailable'},queries:[],waits:[]}
 let connection
 try{
  if(config.engine==='postgresql'){
   const {Client}=await import('pg');connection=new Client({...config.connection,connectionTimeoutMillis:3000,query_timeout:4000,application_name:'porthole-read-only-collector'})
   await connection.connect()
   await connection.query("SET statement_timeout = '3000ms'")
   await connection.query("SET lock_timeout = '500ms'")
   await connection.query('BEGIN READ ONLY')
   const info=(await connection.query("SELECT current_setting('server_version') AS version, extract(epoch FROM clock_timestamp())*1000 AS now")).rows[0]
   capture.version=info.version.split(' ')[0];capture.databaseTime=Math.floor(Number(info.now))
   async function part(key,run){await connection.query('SAVEPOINT porthole_diagnostic');try{const complete=await run();if(capture.coverage[key]!=='privilege_denied')capture.coverage[key]=complete===false?'unavailable':'collected'}catch(error){await connection.query('ROLLBACK TO SAVEPOINT porthole_diagnostic');capture.coverage[key]=denied(error)}finally{await connection.query('RELEASE SAVEPOINT porthole_diagnostic')}}
   await part('statistics',async()=>{
    const rows=(await connection.query("SELECT queryid::text AS id,query,calls,total_exec_time AS total_ms,mean_exec_time AS mean_ms,rows FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND userid=(SELECT oid FROM pg_roles WHERE rolname=$1) ORDER BY total_exec_time DESC LIMIT 25",[config.workloadRole])).rows
    capture.queries=rows.filter(r=>r.query&&r.query!=='<insufficient privilege>').map(r=>({queryId:r.id.replace('-','n'),fingerprint:fingerprint(r.query),calls:Number(r.calls),totalMs:Number(r.total_ms),meanMs:Number(r.mean_ms),rows:Number(r.rows),plan:[]}))
    if(rows.some(r=>!r.query||r.query==='<insufficient privilege>'))capture.coverage.statistics='privilege_denied'
   })
   await part('waits',async()=>{
    const rows=(await connection.query("SELECT a.pid::text AS waiting,b::text AS blocking,a.wait_event_type AS kind,a.query_id::text AS query_id,a.application_name FROM pg_stat_activity a CROSS JOIN LATERAL unnest(pg_blocking_pids(a.pid)) b WHERE a.datname=current_database() AND a.usename=$1 LIMIT 100",[config.workloadRole])).rows
    capture.waits=rows.map(r=>({waiting:r.waiting,blocking:r.blocking,kind:r.kind==='Lock'?'Lock':'unknown',queryId:r.query_id?.replace('-','n')??null,...trace(r.application_name)}))
   })
   if(plans.length)await part('plans',async()=>{let complete=true;for(const template of plans){const sql=template.replace('?','$1'),rows=(await connection.query('EXPLAIN (FORMAT JSON) '+sql,['synthetic-porthole-0'])).rows,plan=structuralPlan(rows[0]['QUERY PLAN'],'postgresql'),q=capture.queries.find(q=>q.fingerprint===fingerprint(sql));if(q)q.plan=plan;else complete=false}return complete})
   await connection.query('ROLLBACK')
  }else{
   const mysql=await import('mysql2/promise');connection=await mysql.createConnection({...config.connection,connectTimeout:3000,multipleStatements:false})
   await connection.query('SET SESSION max_execution_time = 3000')
   await connection.query('SET SESSION lock_wait_timeout = 1')
   await connection.query('START TRANSACTION READ ONLY')
   const [info]=await connection.query('SELECT VERSION() AS version, UNIX_TIMESTAMP(NOW(3))*1000 AS now')
   capture.version=info[0].version;capture.databaseTime=Number(info[0].now)
   async function part(key,run){try{const complete=await run();if(capture.coverage[key]!=='privilege_denied')capture.coverage[key]=complete===false?'unavailable':'collected'}catch(error){capture.coverage[key]=denied(error)}}
   await part('statistics',async()=>{
    const [rows]=await connection.execute('SELECT DIGEST AS id,DIGEST_TEXT AS query,COUNT_STAR AS calls,SUM_TIMER_WAIT/1000000000 AS total_ms,AVG_TIMER_WAIT/1000000000 AS mean_ms,SUM_ROWS_SENT AS rows_sent FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME=? AND DIGEST IS NOT NULL ORDER BY SUM_TIMER_WAIT DESC LIMIT 25',[config.connection.database])
    capture.queries=rows.filter(r=>/^select\b/i.test(r.query)).map(r=>({queryId:r.id,fingerprint:fingerprint(r.query),calls:Number(r.calls),totalMs:Number(r.total_ms),meanMs:Number(r.mean_ms),rows:Number(r.rows_sent),plan:[]}))
   })
   await part('waits',async()=>{
    const [rows]=await connection.query("SELECT t.PROCESSLIST_ID AS waiting,b.PROCESSLIST_ID AS blocking,l.LOCK_TYPE AS kind,v.VARIABLE_VALUE AS traceparent FROM performance_schema.data_lock_waits w JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID JOIN performance_schema.threads b ON b.THREAD_ID=w.BLOCKING_THREAD_ID JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID AND l.ENGINE=w.ENGINE LEFT JOIN performance_schema.user_variables_by_thread v ON v.THREAD_ID=t.THREAD_ID AND v.VARIABLE_NAME='porthole_traceparent' WHERE t.PROCESSLIST_DB=DATABASE() LIMIT 100")
    capture.waits=rows.map(r=>({waiting:String(r.waiting),blocking:String(r.blocking),kind:['RECORD','TABLE'].includes(r.kind)?r.kind:'unknown',queryId:null,...trace(r.traceparent?.toString())}))
   })
   if(plans.length)await part('plans',async()=>{let complete=true;for(const template of plans){const [rows]=await connection.execute('EXPLAIN FORMAT=JSON '+template,['synthetic-porthole-0']),plan=structuralPlan(JSON.parse(rows[0].EXPLAIN),'mysql'),q=capture.queries.find(q=>q.fingerprint===fingerprint(template));if(q)q.plan=plan;else complete=false}return complete})
   await connection.query('ROLLBACK')
  }
 }catch(error){const state=denied(error);for(const key of Object.keys(capture.coverage))if(capture.coverage[key]!=='not_reviewed')capture.coverage[key]=state}
 finally{try{await connection?.end()}catch{}}
 return capture
}
export async function deliver(config,transport=fetch){
 const capture=await collect(config),url=new URL('/api/porthole/v1/database/captures',config.origin)
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('local_intake_required')
 const result=await transport(url,{method:'POST',headers:{authorization:'Bearer '+config.secret,'content-type':'application/json'},body:JSON.stringify({id:config.id,revision:config.revision,planDigest:planDigest(config.plans),capture}),signal:AbortSignal.timeout(10000)})
 if(!result.ok)throw Error('database_intake_refused_'+result.status)
 return {capture,receipt:await result.json()}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{
  const path=process.argv[2],info=await stat(path)
  if(!info.isFile()||(info.mode&0o777)!==0o600||info.uid!==process.getuid())throw Error('private_owner_configuration_required')
  const config=JSON.parse(await readFile(path,'utf8'))
  if(process.argv[3]==='--review')process.stdout.write(JSON.stringify({engine:config.engine,plans:reviewedPlans(config.plans),planDigest:planDigest(config.plans),limits:{queries:25,waits:100,plans:4,statementTimeoutMs:3000},readOnly:true})+'\n')
  else{const result=await deliver(config);process.stdout.write(JSON.stringify({state:'captured',coverage:result.capture.coverage,batchId:result.receipt.batchId})+'\n')}
 }catch{process.stderr.write('database_collection_failed; inspect local privileges and reviewed configuration\n');process.exitCode=1}
}
