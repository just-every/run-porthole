import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import mysql from 'mysql2/promise'
const execute=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
export async function databaseEstate(){
 const names=[],clients=[],password='synthetic-porthole-16001',rolePassword='synthetic-porthole-16002',workPassword='synthetic-porthole-16003',prefix='porthole-db-'+randomUUID().slice(0,8),ports={postgresql:await port(),mysql:await port()}
 async function dispose(){for(const c of clients)try{await c.end()}catch{};for(const name of names.reverse())await execute('docker',['rm','-f',name]).catch(()=>{})}
 try{
  names.push(prefix+'-pg');await execute('docker',['run','-d','--name',names.at(-1),'-p',`127.0.0.1:${ports.postgresql}:5432`,'-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=porthole','postgres:17.6','-c','shared_preload_libraries=pg_stat_statements','-c','compute_query_id=on','-c','pg_stat_statements.track=all'])
  names.push(prefix+'-mysql');await execute('docker',['run','-d','--name',names.at(-1),'-p',`127.0.0.1:${ports.mysql}:3306`,'-e','MYSQL_ROOT_PASSWORD='+password,'-e','MYSQL_ROOT_HOST=%','-e','MYSQL_DATABASE=porthole','mysql:8.4.6','--performance-schema=ON'])
  const connect=async(engine,user,pass)=>{const cfg={host:'127.0.0.1',port:ports[engine],user,password:pass,database:'porthole'};const c=engine==='postgresql'?new pg.Client(cfg):await mysql.createConnection(cfg);if(engine==='postgresql')await c.connect();clients.push(c);return c}
  const admins={}
  for(const engine of ['postgresql','mysql']){
   let ready=false
   for(let attempt=0;attempt<120;attempt++){try{admins[engine]=await connect(engine,engine==='postgresql'?'postgres':'root',password);ready=true;break}catch{await pause(500)}}
   if(!ready)throw Error('local_database_readiness_failed_'+engine)
  }
  const p=admins.postgresql,m=admins.mysql
  await p.query(`CREATE EXTENSION pg_stat_statements; CREATE TABLE porthole_orders(id integer PRIMARY KEY, customer text NOT NULL, amount integer NOT NULL); INSERT INTO porthole_orders SELECT i,'synthetic-porthole-customer-'||i,100 FROM generate_series(1,12000) i; CREATE ROLE porthole_work LOGIN PASSWORD '${workPassword}'; GRANT SELECT,UPDATE ON porthole_orders TO porthole_work; CREATE ROLE porthole_observe LOGIN PASSWORD '${rolePassword}'; GRANT pg_read_all_stats TO porthole_observe; GRANT SELECT ON porthole_orders TO porthole_observe`)
  await m.query('CREATE TABLE porthole_orders(id integer PRIMARY KEY, customer varchar(120) NOT NULL, amount integer NOT NULL)')
  for(let start=1;start<=12000;start+=1000)await m.query('INSERT INTO porthole_orders(id,customer,amount) VALUES ?',[Array.from({length:1000},(_,i)=>[start+i,'synthetic-porthole-customer-'+(start+i),100])])
  await m.query("CREATE USER 'porthole_work'@'%' IDENTIFIED BY ?",[workPassword]);await m.query("GRANT SELECT,UPDATE ON porthole.* TO 'porthole_work'@'%'")
  await m.query("CREATE USER 'porthole_observe'@'%' IDENTIFIED BY ?",[rolePassword]);await m.query("GRANT SELECT ON performance_schema.* TO 'porthole_observe'@'%'");await m.query("GRANT SELECT ON porthole.* TO 'porthole_observe'@'%'")
  await m.query("UPDATE performance_schema.setup_consumers SET ENABLED='YES' WHERE NAME IN ('events_statements_current','events_statements_history','events_waits_current')")
  const config=engine=>({engine,workloadRole:'porthole_work',connection:{host:'127.0.0.1',port:ports[engine],user:'porthole_observe',password:rolePassword,database:'porthole'},plans:['SELECT count(*) FROM porthole_orders WHERE customer = ?']})
  const native=async engine=>{
   if(engine==='postgresql')return (await p.query("SELECT queryid::text AS id,query,calls,total_exec_time AS total_ms,mean_exec_time AS mean_ms,rows FROM pg_stat_statements WHERE userid=(SELECT oid FROM pg_roles WHERE rolname='porthole_work') ORDER BY total_exec_time DESC LIMIT 25")).rows
   return (await m.query("SELECT DIGEST AS id,DIGEST_TEXT AS query,COUNT_STAR AS calls,SUM_TIMER_WAIT/1000000000 AS total_ms,AVG_TIMER_WAIT/1000000000 AS mean_ms,SUM_ROWS_SENT AS rows_sent FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='porthole' AND DIGEST IS NOT NULL ORDER BY SUM_TIMER_WAIT DESC LIMIT 25"))[0]
  }
  async function state(engine){const c=admins[engine],rows=engine==='postgresql'?(await c.query('SELECT count(*) AS count,sum(amount) AS amount FROM porthole_orders')).rows:(await c.query('SELECT count(*) AS count,sum(amount) AS amount FROM porthole_orders'))[0];return rows.map(r=>({count:Number(r.count),amount:Number(r.amount)}))}
  async function restrict(engine){if(engine==='postgresql'){await p.query('REVOKE pg_read_all_stats FROM porthole_observe; REVOKE SELECT ON porthole_orders FROM porthole_observe; REVOKE EXECUTE ON FUNCTION pg_stat_statements(boolean) FROM PUBLIC')}else{await m.query("REVOKE SELECT ON performance_schema.* FROM 'porthole_observe'@'%'");await m.query("REVOKE SELECT ON porthole.* FROM 'porthole_observe'@'%'")}}
  async function rotate(engine){const next='synthetic-porthole-16004';if(engine==='postgresql')await p.query(`ALTER ROLE porthole_observe PASSWORD '${next}'`);else await m.query("ALTER USER 'porthole_observe'@'%' IDENTIFIED BY ?",[next]);return next}
  async function deniedMutation(engine){
   const cfg=config(engine).connection,c=await connect(engine,cfg.user,cfg.password)
   try{await c.query('BEGIN');try{await c.query('UPDATE porthole_orders SET amount=amount+1 WHERE id=1');return false}catch(error){return engine==='postgresql'?error.code==='42501':error.code==='ER_TABLEACCESS_DENIED_ERROR'}}finally{await c.query('ROLLBACK');await c.end();clients.splice(clients.indexOf(c),1)}
  }
  return {ports,config,native,state,restrict,rotate,dispose,deniedMutation,admins,workload:{user:'porthole_work',password:workPassword}}
 }catch(error){await dispose();throw error}
}
