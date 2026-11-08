import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {randomUUID} from 'node:crypto'
import {mkdtemp,writeFile,rm,chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Kafka} from 'kafkajs'
const execute=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms))
export async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
export async function integrationService(pack) {
 const name='porthole-pack-'+randomUUID().slice(0,8),port=await freePort(),password='synthetic-porthole-66002',user='observe',directory=await mkdtemp(join(tmpdir(),'porthole-pack-')),resources=[]
 const env={PORTHOLE_SELF_PORT:String(await freePort()),PORTHOLE_DIAGNOSTIC_LOG:join(directory,'diagnostics.log'),PORTHOLE_STATE_DIR:join(directory,'state')},prefix='PORTHOLE_'+pack.id.toUpperCase(),args=['run','-d','--name',name],ex=async(...argv)=>(await execute('docker',['exec',name,...argv],{maxBuffer:1024*1024})).stdout
 const setting=(key,value)=>args.push('-e',key+'='+value)
 const publish=p=>args.push('-p',`127.0.0.1:${port}:${p}`)
 let endpoint,ready,setup=async()=>{},workload,stats,deny,restore,metric=pack.metrics[0].name
 const fetchJson=async(path,options={},admin=false)=>{const r=await fetch(endpoint+path,{signal:AbortSignal.timeout(15000),...options,headers:{authorization:'Basic '+Buffer.from((admin?'elastic':user)+':'+password).toString('base64'),'content-type':'application/json',...options.headers}});if(!r.ok)throw Error('local_service_http_'+r.status);const text=await r.text();return text?JSON.parse(text):{}}
 const dispose=async()=>{for(const r of resources)await r().catch(()=>{});await execute('docker',['rm','-f',name]).catch(()=>{});await rm(directory,{recursive:true,force:true})}
 if(pack.id==='postgresql') {
  publish(5432);setting('POSTGRES_PASSWORD',password);setting('POSTGRES_DB','porthole');endpoint='127.0.0.1:'+port
  const sql=query=>ex('psql','-U','postgres','-d','porthole','-Atc',query)
  ready=()=>sql('SELECT 1')
  setup=()=>sql(`CREATE ROLE observe LOGIN PASSWORD '${password}'; GRANT pg_monitor TO observe; REVOKE CONNECT ON DATABASE porthole FROM PUBLIC; GRANT CONNECT ON DATABASE porthole TO observe`)
  workload=async()=>{for(let i=0;i<7;i++)await sql('BEGIN;SELECT 1;COMMIT');return 7}
  stats=async()=>Number((await sql("SELECT xact_commit FROM pg_stat_database WHERE datname='porthole'")).trim())
  deny=()=>sql('REVOKE CONNECT ON DATABASE porthole FROM observe; SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=\'observe\'')
  restore=()=>sql('GRANT CONNECT ON DATABASE porthole TO observe')
  env[prefix+'_DATABASE']='porthole'
 }else if(pack.id==='mysql') {
  publish(3306);setting('MYSQL_ROOT_PASSWORD',password);endpoint='127.0.0.1:'+port
  const sql=query=>ex('mysql','-uroot','-p'+password,'--batch','--skip-column-names','-e',query)
  ready=()=>sql('SELECT 1')
  setup=()=>sql(`CREATE USER observe IDENTIFIED BY '${password}'; GRANT PROCESS, REPLICATION CLIENT ON *.* TO observe; GRANT SELECT ON performance_schema.* TO observe`)
  workload=async()=>{for(let i=0;i<7;i++)await sql('SELECT 1');return 7}
  stats=async()=>Number((await sql("SHOW GLOBAL STATUS LIKE 'Com_select'")).trim().split(/\s+/).at(-1))
  deny=()=>sql(`ALTER USER observe ACCOUNT LOCK`);restore=()=>sql(`ALTER USER observe ACCOUNT UNLOCK`)
 }else if(pack.id==='redis') {
  publish(6379);endpoint='127.0.0.1:'+port
  const redis=(...a)=>ex('redis-cli',...a)
  ready=()=>redis('PING');setup=()=>redis('ACL','SETUSER',user,'on','>'+password,'-@all','+info','+ping')
  workload=async()=>{for(let i=0;i<7;i++)await redis('SET','synthetic-porthole-'+i,'synthetic-porthole-66003');return 7}
  stats=async()=>Number((await redis('INFO','keyspace')).match(/db0:keys=(\d+)/)[1])
  deny=()=>redis('ACL','SETUSER',user,'-info');restore=()=>redis('ACL','SETUSER',user,'+info')
 }else if(pack.id==='nginx') {
  publish(80);endpoint='http://127.0.0.1:'+port+'/status'
  const config='events {}\nhttp { access_log /proof/access.log; error_log /proof/error.log error; server { listen 80; location /status { stub_status; access_log off; } location /load { return 200 "synthetic-porthole-66004"; } location /missing { root /not-present; } } }'
  await writeFile(join(directory,'nginx.conf'),config);await writeFile(join(directory,'access.log'),'');await writeFile(join(directory,'error.log'),'')
  args.push('-v',directory+':/proof','-v',join(directory,'nginx.conf')+':/etc/nginx/nginx.conf:ro')
  env.PORTHOLE_NGINX_ACCESS_LOG=join(directory,'access.log');env.PORTHOLE_NGINX_ERROR_LOG=join(directory,'error.log')
  ready=async()=>{const r=await fetch(endpoint);if(!r.ok)throw Error('not_ready')}
  workload=async()=>{for(let i=0;i<7;i++)await fetch('http://127.0.0.1:'+port+'/load');await fetch('http://127.0.0.1:'+port+'/missing');return 8}
  stats=async()=>Number((await (await fetch(endpoint)).text()).trim().split('\n')[2].trim().split(/\s+/)[2])
  deny=async()=>{await writeFile(join(directory,'nginx.conf'),config.replace('stub_status;','deny all; stub_status;'));await ex('nginx','-s','reload');await pause(500)}
  restore=async()=>{await writeFile(join(directory,'nginx.conf'),config);await ex('nginx','-s','reload');await pause(500)}
 }else if(pack.id==='rabbitmq') {
  publish(15672);setting('RABBITMQ_DEFAULT_USER','observe');setting('RABBITMQ_DEFAULT_PASS',password);endpoint='http://127.0.0.1:'+port
  ready=()=>fetchJson('/api/overview');setup=async()=>{await ex('rabbitmqctl','add_user','work',password);await ex('rabbitmqctl','set_user_tags','work','administrator');await ex('rabbitmqctl','set_permissions','-p','/','work','.*','.*','.*');await ex('rabbitmqctl','set_user_tags',user,'monitoring');await ex('rabbitmqctl','set_permissions','-p','/',user,'^$','^$','^$')}
  const work=async(path,data,method='PUT')=>fetchJson(path,{method,headers:{authorization:'Basic '+Buffer.from('work:'+password).toString('base64')},body:JSON.stringify(data)})
  workload=async()=>{await work('/api/queues/%2F/porthole',{durable:false,auto_delete:false,arguments:{}});for(let i=0;i<7;i++)await work('/api/exchanges/%2F/amq.default/publish',{properties:{},routing_key:'porthole',payload:'synthetic-porthole-66005',payload_encoding:'string'},'POST');for(let i=0;i<60&&await stats()!==7;i++)await pause(250);if(await stats()!==7)throw Error('rabbitmq_management_counters_not_ready');return 7}
  stats=async()=>{const s=await fetchJson('/api/queues/%2F/porthole');return Number(s.messages??0)}
  deny=()=>ex('rabbitmqctl','set_user_tags',user);restore=()=>ex('rabbitmqctl','set_user_tags',user,'monitoring')
 }else if(pack.id==='mongodb') {
  publish(27017);setting('MONGO_INITDB_ROOT_USERNAME','root');setting('MONGO_INITDB_ROOT_PASSWORD',password);endpoint='127.0.0.1:'+port
  const sql=script=>ex('mongosh','--quiet','--username','root','--password',password,'--authenticationDatabase','admin','--eval',script)
  ready=()=>sql('db.runCommand({ping:1})');setup=()=>sql(`db.createUser({user:'observe',pwd:'${password}',roles:[{role:'clusterMonitor',db:'admin'}]})`)
  workload=async()=>{await sql('db.getSiblingDB("porthole").records.insertMany(Array.from({length:7},(_,i)=>({value:i})))');return 7}
  stats=async()=>{const r=await sql('JSON.stringify({insert:Number(db.serverStatus().opcounters.insert)})');return Number(JSON.parse(r.trim()).insert)}
  deny=()=>sql("db.revokeRolesFromUser('observe',[{role:'clusterMonitor',db:'admin'}])");restore=()=>sql("db.grantRolesToUser('observe',[{role:'clusterMonitor',db:'admin'}])")
 }else if(pack.id==='elasticsearch') {
  publish(9200);setting('discovery.type','single-node');setting('xpack.security.enabled','true');setting('xpack.security.http.ssl.enabled','false');setting('ELASTIC_PASSWORD',password);setting('ES_JAVA_OPTS','-Xms256m -Xmx256m');endpoint='http://127.0.0.1:'+port
  ready=()=>fetchJson('/',{},true)
  const grant=()=>fetchJson('/_security/role/observe',{method:'PUT',body:JSON.stringify({cluster:['monitor'],indices:[{names:['*'],privileges:['monitor']}]})},true)
  setup=async()=>{await grant();await fetchJson('/_security/user/observe',{method:'POST',body:JSON.stringify({password,roles:['observe']})},true)}
  workload=async()=>{for(let i=0;i<7;i++)await fetchJson('/porthole/_doc/'+i+'?refresh=true',{method:'PUT',body:JSON.stringify({value:i})},true);return 7}
  stats=async()=>{const s=await fetchJson('/_nodes/stats/indices',{},true);return Object.values(s.nodes).reduce((n,node)=>n+node.indices.docs.count,0)}
  deny=()=>fetchJson('/_security/user/observe/_disable',{method:'PUT'},true);restore=()=>fetchJson('/_security/user/observe/_enable',{method:'PUT'},true)
 }else if(pack.id==='kafka') {
  args.push('--network','host');const controller=await freePort();endpoint='127.0.0.1:'+port
  for(const [k,v]of Object.entries({KAFKA_OPTS:'-Djava.security.auth.login.config=/proof/kafka_server_jaas.conf',KAFKA_NODE_ID:'1',KAFKA_PROCESS_ROLES:'broker,controller',KAFKA_LISTENERS:`SASL_PLAINTEXT://127.0.0.1:${port},CONTROLLER://127.0.0.1:${controller}`,KAFKA_ADVERTISED_LISTENERS:'SASL_PLAINTEXT://127.0.0.1:'+port,KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:'CONTROLLER:PLAINTEXT,SASL_PLAINTEXT:SASL_PLAINTEXT',KAFKA_CONTROLLER_QUORUM_VOTERS:'1@127.0.0.1:'+controller,KAFKA_CONTROLLER_LISTENER_NAMES:'CONTROLLER',KAFKA_INTER_BROKER_LISTENER_NAME:'SASL_PLAINTEXT',KAFKA_SASL_ENABLED_MECHANISMS:'PLAIN',KAFKA_SASL_MECHANISM_INTER_BROKER_PROTOCOL:'PLAIN',KAFKA_LISTENER_NAME_SASL_PLAINTEXT_PLAIN_SASL_JAAS_CONFIG:`org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="${password}" user_admin="${password}" user_observe="${password}";`,KAFKA_OFFSETS_TOPIC_NUM_PARTITIONS:'1',KAFKA_NUM_PARTITIONS:'1',KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS:'0',KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR:'1',KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR:'1',KAFKA_TRANSACTION_STATE_LOG_MIN_ISR:'1',KAFKA_AUTHORIZER_CLASS_NAME:'org.apache.kafka.metadata.authorizer.StandardAuthorizer',KAFKA_SUPER_USERS:'User:admin;User:ANONYMOUS'}))setting(k,v)
  const kafka=new Kafka({clientId:'synthetic-porthole-66006',brokers:[endpoint],sasl:{mechanism:'plain',username:'admin',password},retry:{retries:0},connectionTimeout:1000,requestTimeout:2000,logLevel:0}),admin=kafka.admin(),producer=kafka.producer();resources.push(()=>admin.disconnect(),()=>producer.disconnect())
  ready=async()=>{await admin.connect();await admin.listTopics()}
  await chmod(directory,0o755);await writeFile(join(directory,'kafka_server_jaas.conf'),`KafkaServer { org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="${password}" user_admin="${password}" user_observe="${password}"; };`);await writeFile(join(directory,'admin.properties'),`security.protocol=SASL_PLAINTEXT\nsasl.mechanism=PLAIN\nsasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="${password}";\n`);args.push('-v',directory+':/proof')
  const acl=mode=>ex('/opt/kafka/bin/kafka-acls.sh','--bootstrap-server',endpoint,'--command-config','/proof/admin.properties',mode,'--allow-principal','User:observe','--operation','Describe','--topic','*','--group','*',...(mode==='--remove'?['--force']:[]))
  setup=async()=>{await acl('--add');await admin.createTopics({topics:[{topic:'porthole',numPartitions:1,replicationFactor:1}]})}
  workload=async()=>{await producer.connect();await producer.send({topic:'porthole',messages:Array.from({length:7},(_,i)=>({value:'synthetic-porthole-'+i}))});let committed=false;for(let i=0;i<40;i++){try{await admin.setOffsets({groupId:'porthole',topic:'porthole',partitions:[{partition:0,offset:'0'}]});committed=true;break}catch{await pause(500)}}if(!committed)throw Error('kafka_group_offset_not_committed');return 7}
  stats=async()=>Number((await admin.fetchTopicOffsets('porthole'))[0].high)
  deny=()=>acl('--remove');restore=()=>acl('--add')
 }else throw Error('unsupported_pack')
 env[prefix+'_ENDPOINT']=endpoint;env[prefix+'_USERNAME']=user;env[prefix+'_PASSWORD']=password
 try {
  const launched=await execute('docker',[...args,pack.serviceImage],{maxBuffer:1024*1024});
  let ok=false;for(let i=0;i<120;i++){try{await ready();ok=true;break}catch{await pause(500)}}
  if(!ok)throw Error('service_not_ready_'+pack.id)
  await setup()
  return {env,workload,stats,deny,restore,metric,password,directory,dispose}
 }catch(error){await dispose();throw error}
}
