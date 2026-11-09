import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:http'
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {releases as networkPins} from '../../../collectors/network/release.mjs'
import {releases as messagingPins} from '../../../collectors/messaging/release.mjs'
import {networkConfiguration} from '../../../collectors/network/configuration.mjs'
import {messagingConfiguration} from '../../../collectors/messaging/configuration.mjs'
const execute=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms))
const password='synthetic-porthole-network-secret',destination='synthetic-porthole-network-orders'
export async function networkEstate({dispatch,secret}) {
 const tag='porthole-network-'+randomUUID().slice(0,8),scratch=await mkdtemp(join(tmpdir(),tag)),containers=[],packets=[],windows=[],denials=[],root=process.cwd()
 const docker=async(...args)=>{const r=await execute('docker',args,{timeout:180000,maxBuffer:4*1024*1024});return (r.stdout+(args[0]==='logs'?r.stderr:'')).trim()}
 const gateway=createServer(async(req,res)=>{
  try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks),type=req.headers['content-type']??'application/x-protobuf';packets.push({path:req.url,body,type,encoding:req.headers['content-encoding']??null});const response=await dispatch(req.url,{method:'POST',headers:{'content-type':type,...(req.headers['content-encoding']?{'content-encoding':req.headers['content-encoding']}:{}),authorization:'Bearer '+secret},body});if(!response.ok)console.log('Network stock export HTTP '+response.status+' '+await response.clone().text());res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/x-protobuf'});res.end(Buffer.from(await response.arrayBuffer()))}catch{res.writeHead(503);res.end()}
 })
 let network,ids={},addresses={},exportEndpoint,internalNoProxy='localhost,127.0.0.1'
 const roles=['checkout-kafka','fulfillment-kafka','checkout-rabbitmq','fulfillment-rabbitmq']
 async function create(name,args,options={}){const full=tag+'-'+name;containers.push(full);const id=await docker('create','--name',full,...(options.namespace?['--network','container:'+tag+'-'+options.namespace]:['--network',tag,'--network-alias',name]),...args);ids[name]=id;return full}
 async function run(name,args,options={}){const full=await create(name,args,options);await docker('start',full);return full}
 const inspect=async name=>JSON.parse(await docker('inspect',tag+'-'+name))[0]
 async function waitFor(name,test){for(let i=0;i<100;i++){if(await test().catch(()=>false))return;const s=await inspect(name);if(!s.State.Running)throw Error(name+' exited: '+(await docker('logs',tag+'-'+name)).slice(-1800));await pause(250)}throw Error(name+' readiness timed out')}
 const app=async(role,path)=>{const r=await fetch('http://127.0.0.1:'+addresses[role]+path,{signal:AbortSignal.timeout(90000)});assert.equal(r.status,200,await r.clone().text());return r.json()}
 const stats=async()=>Object.fromEntries(await Promise.all(roles.map(async role=>[role,await app(role,'/stats')])) )
 async function command(name,args){return docker('exec',tag+'-'+name,...args)}
 async function kafkaCommand(tool,args){return command('kafka',['/opt/kafka/bin/kafka-'+tool+'.sh','--bootstrap-server','kafka:9092','--command-config','/run/admin.properties',...args])}
 async function netem(namespace,args,capability=true){return docker('run','--rm','--network','container:'+tag+'-'+namespace,...(capability?['--cap-add','NET_ADMIN']:[]),networkPins.netem,'tc',...args).catch(error=>{if(/qdisc kind is unknown/.test(error.stderr??''))throw Error('network_fault_kernel_unavailable: CONFIG_NET_SCH_NETEM and CONFIG_NET_SCH_PRIO required; '+error.stderr.trim());throw error})}
 async function snap(){return {atNs:String(BigInt(Date.now())*1000000n),apps:await stats(),snmp:await command('checkout-kafka',['cat','/proc/net/snmp']),netstat:await command('checkout-kafka',['cat','/proc/net/netstat']),kafka:await kafkaCommand('consumer-groups',['--describe','--group','synthetic-porthole-network-group']),rabbit:await command('rabbit',['rabbitmqctl','-q','list_queues','name','messages_ready','messages_unacknowledged','messages'])}}
 async function record(name,injected,run){
  console.log('Network window: '+name)
  const from=String(BigInt(Date.now())*1000000n),before=await snap();await run();await pause(4500);for(const role of roles)await app(role,'/flush');await pause(500)
  const after=await snap(),through=String(BigInt(Date.now())*1000000n),window={name,injected,from,through,before,after};windows.push(window);return window
 }
 async function collect(name,config,mountSocket=true){const file=join(scratch,name+'.json');await writeFile(file,JSON.stringify(config));return run(name,['--user','0:0','-e','NO_PROXY='+internalNoProxy,'-e','no_proxy='+internalNoProxy,'-v',file+':/etc/otelcol/config.json:ro',...(mountSocket?['-v','/var/run/docker.sock:/var/run/docker.sock:ro']:[]),'-e','KAFKA_READER_PASSWORD='+password,'-e','RABBITMQ_MONITOR_PASSWORD='+password,networkPins.collector,'--config=/etc/otelcol/config.json'])}
 async function start(){
  await docker('network','create',tag);network=JSON.parse(await docker('network','inspect',tag))[0];const gatewayIp=network.IPAM.Config[0].Gateway
  internalNoProxy+=','+gatewayIp+',kafka,rabbit,'+roles.join(',')+',.porthole.test'
  ids.host=(await docker('info','--format','{{.ID}}')).trim()
  await new Promise(r=>gateway.listen(0,'0.0.0.0',r));exportEndpoint='http://'+gatewayIp+':'+gateway.address().port
  await writeFile(join(scratch,'admin.properties'),'request.timeout.ms=3000\ndefault.api.timeout.ms=5000\nsecurity.protocol=SASL_PLAINTEXT\nsasl.mechanism=PLAIN\nsasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="'+password+'";\n')
  await writeFile(join(scratch,'kafka-jaas.conf'),'KafkaServer { org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="'+password+'" user_admin="'+password+'" user_reader="'+password+'"; };\n')
  await run('kafka',['-v',join(scratch,'kafka-jaas.conf')+':/run/kafka-jaas.conf:ro','-e','KAFKA_OPTS=-Djava.security.auth.login.config=/run/kafka-jaas.conf','-v',join(scratch,'admin.properties')+':/run/admin.properties:ro','-e','KAFKA_NODE_ID=1','-e','KAFKA_PROCESS_ROLES=broker,controller','-e','KAFKA_LISTENERS=SASL_PLAINTEXT://:9092,CONTROLLER://:9093','-e','KAFKA_ADVERTISED_LISTENERS=SASL_PLAINTEXT://kafka:9092','-e','KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka:9093','-e','KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER','-e','KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,SASL_PLAINTEXT:SASL_PLAINTEXT','-e','KAFKA_INTER_BROKER_LISTENER_NAME=SASL_PLAINTEXT','-e','KAFKA_SASL_MECHANISM_INTER_BROKER_PROTOCOL=PLAIN','-e','KAFKA_SASL_ENABLED_MECHANISMS=PLAIN','-e','KAFKA_LISTENER_NAME_SASL_PLAINTEXT_PLAIN_SASL_JAAS_CONFIG=org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="'+password+'" user_admin="'+password+'" user_reader="'+password+'";','-e','KAFKA_AUTHORIZER_CLASS_NAME=org.apache.kafka.metadata.authorizer.StandardAuthorizer','-e','KAFKA_SUPER_USERS=User:admin;User:ANONYMOUS','-e','KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1','-e','KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1','-e','KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1',messagingPins.kafka])
  await run('rabbit',['-e','RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS=-rabbit collect_statistics_interval 1000','-e','RABBITMQ_DEFAULT_USER=workload','-e','RABBITMQ_DEFAULT_PASS='+password,messagingPins.rabbitmq])
  ids.rabbitmq=ids.rabbit
  await waitFor('kafka',()=>kafkaCommand('topics',['--list']).then(()=>true))
  await kafkaCommand('topics',['--create','--topic',destination,'--partitions','1','--replication-factor','1'])
  for(const args of [['--topic','*'],['--group','*'],['--cluster']])await kafkaCommand('acls',['--add','--allow-principal','User:reader','--operation','Describe',...args])
  await waitFor('rabbit',()=>command('rabbit',['rabbitmqctl','await_startup']).then(()=>true))
  await command('rabbit',['rabbitmqctl','add_user','monitor',password]);await command('rabbit',['rabbitmqctl','set_user_tags','monitor','monitoring']);await command('rabbit',['rabbitmqctl','set_permissions','-p','/','monitor','','','.*'])
  // Create first, then declare the real Docker IDs before starting SDKs.
  for(const role of roles){
   const system=role.endsWith('kafka')?'kafka':'rabbitmq'
   await create(role,['-p','127.0.0.1::8080','-v',root+':/app:ro','-v',scratch+':/run:ro','-w','/app','-e','NO_PROXY='+internalNoProxy,'-e','no_proxy='+internalNoProxy,'-e','ROLE='+role,'-e','SYSTEM='+system,'-e','DESTINATION='+destination,'-e','WORKLOAD_PASSWORD='+password,'-e','CONSUMER_HOST=fulfillment-'+system+'.porthole.test','-e','OTEL_SERVICE_NAME='+role,'-e','OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production,team.name=commerce','-e','OTEL_EXPORTER_OTLP_TRACES_ENDPOINT='+exportEndpoint+'/v1/traces','-e','OTEL_METRICS_EXPORTER=none','-e','OTEL_LOGS_EXPORTER=none',networkPins.workload,'node','tests/porthole/network/producer.cjs'])
  }
  for(const role of roles){const row=await inspect(role);addresses[role]=row.HostConfig.PortBindings['8080/tcp'][0].HostPort}
  const dnsHosts=[]
  for(const role of roles){const row=await inspect(role),ip=row.NetworkSettings.Networks[tag].IPAddress;if(ip)dnsHosts.push(ip+' '+role+'.porthole.test')}
  // Created containers receive addresses on start; start consumers first, whose
  // broker lookups use the bridge's built-in internal service discovery.
  await writeFile(join(scratch,'identities.json'),JSON.stringify(ids))
  for(const role of roles.filter(r=>r.startsWith('fulfillment')))await docker('start',tag+'-'+role)
  for(const role of roles.filter(r=>r.startsWith('fulfillment'))){const row=await inspect(role);addresses[role]=row.NetworkSettings.Ports['8080/tcp'][0].HostPort;dnsHosts.push(row.NetworkSettings.Networks[tag].IPAddress+' '+role+'.porthole.test')}
  await writeFile(join(scratch,'hosts'),dnsHosts.join('\n')+'\n')
  await writeFile(join(scratch,'Corefile'),'.:53 {\n errors\n hosts /run/hosts {\n ttl 1\n no_reverse\n }\n}\n')
  await run('resolver',['--user','0:0','-v',scratch+':/run:ro',networkPins.resolver,'-conf','/run/Corefile'])
  await waitFor('resolver',async()=>{const r=await inspect('resolver');return r.State.Running&&!!r.NetworkSettings.Networks[tag].IPAddress})
  const resolverIp=(await inspect('resolver')).NetworkSettings.Networks[tag].IPAddress
  // Docker DNS delegates unknown application FQDNs to our owned CoreDNS.
  for(const role of roles.filter(r=>r.startsWith('checkout'))){
   const old=await inspect(role),full=tag+'-'+role;await docker('rm',full);containers.splice(containers.indexOf(full),1)
   const env=old.Config.Env.flatMap(v=>['-e',v]);await create(role,['--dns',resolverIp,'-p','127.0.0.1::8080','-v',root+':/app:ro','-v',scratch+':/run:ro','-w','/app',...env,networkPins.workload,'node','tests/porthole/network/producer.cjs'])
  }
  await writeFile(join(scratch,'identities.json'),JSON.stringify(ids))
  for(const role of roles.filter(r=>r.startsWith('checkout'))){await docker('start',tag+'-'+role);const row=await inspect(role);addresses[role]=row.NetworkSettings.Ports['8080/tcp'][0].HostPort}
  for(const role of roles)await waitFor(role,()=>app(role,'/stats').then(()=>true))
  console.log('Network: counted Kafka and RabbitMQ runtimes ready')
  await run('node-exporter',['--pid','container:'+tag+'-checkout-kafka',networkPins.nodeExporter,'--collector.disable-defaults','--collector.netstat','--collector.netstat.fields=^(Tcp_RetransSegs|TcpExt_TCPTimeouts)$','--web.listen-address=:9100'],{namespace:'checkout-kafka'})
  const identity={service:'checkout-kafka',environment:'production',team:'commerce',containerId:ids['checkout-kafka'],hostId:ids.host}
  await collect('network-collector',networkConfiguration({identity,exportEndpoint}))
  for(const system of ['kafka','rabbitmq'])await collect(system+'-collector',messagingConfiguration({identity:{...identity,service:'checkout-'+system,containerId:ids[system],brokerId:ids[system]},consumerIdentity:{...identity,service:'fulfillment-'+system,containerId:ids[system],brokerId:ids[system]},system,exportEndpoint}),false)
  return {tag,ids,addresses}
 }
 async function exercise(){
  await record('baseline',{transactionsPerBroker:12},async()=>{for(const s of ['kafka','rabbitmq'])await app('checkout-'+s,'/work?count=12&window=baseline')})
  await record('dns-delay',{resolverInterface:'eth0',delayMs:80,transactions:8},async()=>{await netem('resolver',['qdisc','add','dev','eth0','root','netem','delay','80ms']);try{await app('checkout-kafka','/work?count=8&window=dns-delay')}finally{await netem('resolver',['qdisc','del','dev','eth0','root'])}})
  await record('packet-loss',{sourceContainer:ids['checkout-kafka'],targetContainer:ids['fulfillment-kafka'],lossPercent:20,transactions:12},async()=>{
   const ip=(await inspect('fulfillment-kafka')).NetworkSettings.Networks[tag].IPAddress
   await netem('checkout-kafka',['qdisc','add','dev','eth0','root','handle','1:','prio']);await netem('checkout-kafka',['qdisc','add','dev','eth0','parent','1:3','handle','30:','netem','loss','20%']);await netem('checkout-kafka',['filter','add','dev','eth0','protocol','ip','parent','1:0','prio','1','u32','match','ip','dst',ip+'/32','flowid','1:3'])
   try{await app('checkout-kafka','/work?count=12&window=packet-loss')}finally{await netem('checkout-kafka',['qdisc','del','dev','eth0','root'])}
  })
  await record('backlog',{pausedKafkaGroup:'synthetic-porthole-network-group',pausedRabbitConsumer:true,transactionsPerBroker:24},async()=>{
   for(const s of ['kafka','rabbitmq'])await app('fulfillment-'+s,'/pause')
   for(const s of ['kafka','rabbitmq'])await app('checkout-'+s,'/work?count=24&window=backlog')
  })
  await record('restored-consumers',{resumed:true},async()=>{for(const s of ['kafka','rabbitmq'])await app('fulfillment-'+s,'/resume')})
  await record('application-failures',{unresolvableName:true,closedApplicationPort:1},async()=>{await app('checkout-kafka','/dns-failure');await app('checkout-kafka','/connection-failure')})
  for(const [name,remove,restore,privilege] of [
   ['namespace',()=>docker('stop',tag+'-node-exporter'),()=>docker('start',tag+'-node-exporter'),'affected network namespace access'],
   ['docker-socket',async()=>{await docker('stop',tag+'-network-collector');await collect('network-no-socket',networkConfiguration({identity:{service:'checkout-kafka',environment:'production',team:'commerce',containerId:ids['checkout-kafka'],hostId:ids.host},exportEndpoint}),false)},async()=>{await docker('stop',tag+'-network-no-socket');await docker('start',tag+'-network-collector')},'Docker socket read access'],
   ['kafka-grant',()=>kafkaCommand('acls',['--remove','--force','--allow-principal','User:reader','--operation','Describe','--group','*']),()=>kafkaCommand('acls',['--add','--allow-principal','User:reader','--operation','Describe','--group','*']),'Kafka consumer group Describe ACL'],
   ['rabbit-permission',async()=>{await command('rabbit',['rabbitmqctl','set_user_tags','monitor']);await command('rabbit',['rabbitmqctl','clear_permissions','-p','/','monitor'])},async()=>{await command('rabbit',['rabbitmqctl','set_user_tags','monitor','monitoring']);await command('rabbit',['rabbitmqctl','set_permissions','-p','/','monitor','','','.*'])},'RabbitMQ monitoring user vhost permission'],
  ]){
   await remove();await record('denied-'+name,{removed:privilege},async()=>{await pause(16000);for(const system of ['kafka','rabbitmq'])await app('checkout-'+system,'/work?count=1&window=denied-'+name)});denials.push({name,privilege,state:'removed'});await restore();await record('restored-'+name,{restored:privilege},async()=>{for(const system of ['kafka','rabbitmq'])await app('checkout-'+system,'/work?count=1&window=restored-'+name)})
  }
  try{await netem('checkout-kafka',['qdisc','add','dev','eth0','root','netem','loss','1%'],false);throw Error('NET_ADMIN removal unexpectedly permitted tc')}catch(error){assert.match(String(error.stderr??error.message),/not permitted|permission denied/i);denials.push({name:'NET_ADMIN',privilege:'NET_ADMIN',state:'denied',diagnostic:'RTNETLINK operation not permitted'})}
  // OBI is always the official digest. A kernel refusal is a recorded gap,
  // never substituted with manufactured flow records.
  for(const caps of [[],['BPF'],['PERFMON'],['BPF','PERFMON']]){
   const name='obi-'+(caps.join('-')||'none')
   try{await run(name,['--pid','container:'+tag+'-checkout-kafka',...caps.flatMap(c=>['--cap-add',c]),'-e','OTEL_EBPF_OPEN_PORT=8080','-e','OTEL_EXPORTER_OTLP_ENDPOINT='+exportEndpoint,networkPins.obi],{namespace:'checkout-kafka'});await pause(3000);const state=(await inspect(name)).State,logs=await docker('logs',tag+'-'+name);denials.push({name,privilege:'BPF and PERFMON with kernel support',state:state.Running?'running-unqualified':'kernel-or-privilege-gap',diagnostic:logs.slice(-1600)});if(state.Running)await docker('stop',tag+'-'+name)}catch(error){denials.push({name,privilege:'BPF and PERFMON with kernel support',state:'kernel-or-privilege-gap',diagnostic:String(error.stderr??error.message).slice(-1000)})}
  }
  for(const role of roles)await app(role,'/flush');await pause(500)
  return {windows,denials,packets,stats:await stats(),ids,pins:{...networkPins,...messagingPins}}
 }
 async function stop(){for(const name of [...containers].reverse()){await docker('rm','-f',name).catch(()=>{})}if(network)await docker('network','rm',tag).catch(()=>{});if(gateway.listening)await new Promise(r=>gateway.close(r));await rm(scratch,{recursive:true,force:true})}
 return {start,exercise,stop,app,stats,windows,packets,denials,ids,diagnostics:async()=>Promise.all(containers.filter(n=>n.includes('collector')).map(async name=>({name,state:JSON.parse(await docker('inspect',name))[0].State,logs:await docker('logs',name)})))}
}
