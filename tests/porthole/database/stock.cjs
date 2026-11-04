// Real requests and real SQL, emitted by unmodified official instrumentation.
const {NodeSDK}=require('@opentelemetry/sdk-node')
const {OTLPTraceExporter}=require('@opentelemetry/exporter-trace-otlp-proto')
const {HttpInstrumentation}=require('@opentelemetry/instrumentation-http')
const {PgInstrumentation}=require('@opentelemetry/instrumentation-pg')
const {MySQL2Instrumentation}=require('@opentelemetry/instrumentation-mysql2')
const sdk=new NodeSDK({traceExporter:new OTLPTraceExporter(),instrumentations:[new HttpInstrumentation(),new PgInstrumentation({enhancedDatabaseReporting:true}),new MySQL2Instrumentation({maskStatement:false})]})
sdk.start()
const http=require('node:http'),pg=require('pg'),mysql=require('mysql2/promise'),{trace,context}=require('@opentelemetry/api')
const cfg=JSON.parse(process.env.PORTHOLE_DATABASE_WORKLOAD),clients=[],counts={postgresql:0,mysql:0},pending=[]
const open=async engine=>{const c=engine==='postgresql'?new pg.Client({...cfg[engine]}):await mysql.createConnection(cfg[engine]);if(engine==='postgresql')await c.connect();clients.push(c);return c}
const query=(engine,c,sql,args)=>c.query(sql,args)
let blockers={}
const server=http.createServer(async(req,res)=>{
 try{
  const engine=req.url.split('/')[1],mode=req.url.split('/')[2],c=await open(engine),span=trace.getSpan(context.active()),ctx=span.spanContext(),traceparent=`00-${ctx.traceId}-${ctx.spanId}-01`
  let id
  if(engine==='postgresql'){id=String((await c.query('SELECT pg_backend_pid() AS id')).rows[0].id);await c.query("SELECT set_config('application_name',$1,false)",[traceparent])}
  else{id=String(c.threadId);await c.execute('SET @porthole_traceparent = ?',[traceparent])}
  span.setAttribute('porthole.database.connection_id',id)
  span.setAttribute('http.route','/'+engine+'/'+mode)
  if(mode==='error'){await query(engine,c,engine==='postgresql'?'SELECT cast($1 AS integer)':'SELECT cast(? AS JSON)',[cfg.marker])}
  if(mode==='blocked'){
   const b=await open(engine),holder=await open(engine),bid=engine==='postgresql'?String((await b.query('SELECT pg_backend_pid() AS id')).rows[0].id):String(b.threadId),holderId=engine==='postgresql'?String((await holder.query('SELECT pg_backend_pid() AS id')).rows[0].id):String(holder.threadId)
   if(engine==='postgresql')await b.query("SELECT set_config('application_name',$1,false)",[traceparent]);else await b.execute('SET @porthole_traceparent = ?',[traceparent])
   await query(engine,holder,'BEGIN');await query(engine,holder,'UPDATE porthole_orders SET amount = amount WHERE id = 1')
   await query(engine,b,'BEGIN');await query(engine,b,'UPDATE porthole_orders SET amount = amount WHERE id = 2')
   const middle=query(engine,b,'SELECT amount FROM porthole_orders WHERE id = 1 FOR UPDATE')
   blockers[engine]={waiting:id,blocking:bid,chainHolder:holderId,traceId:ctx.traceId,spanId:ctx.spanId}
   process.stdout.write(JSON.stringify({event:'blocking',engine,...blockers[engine]})+'\n')
   const operation=query(engine,c,'SELECT amount FROM porthole_orders WHERE id = 2 FOR UPDATE')
   await new Promise(resolve=>pending.push(async()=>{await query(engine,holder,'ROLLBACK');await middle;await query(engine,b,'ROLLBACK');resolve()}));await operation
  }else{
   for(let i=0;i<6;i++){const result=await query(engine,c,'SELECT count(*) FROM porthole_orders WHERE customer = '+(engine==='postgresql'?'$1':'?'),[cfg.marker]);counts[engine]++}
  }
  await c.end();clients.splice(clients.indexOf(c),1)
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({traceId:ctx.traceId,spanId:ctx.spanId,connectionId:id,engine,calls:counts[engine]}))
 }catch(error){process.stdout.write(JSON.stringify({event:'failed',engine:req.url.split('/')[1],code:String(error.code??'unknown')})+'\n');res.writeHead(500);res.end('database_workload_failed_'+String(error.code??'unknown'))}
})
async function stop(){for(const release of pending.splice(0))await release();await new Promise(r=>server.close(r));for(const c of clients)try{await c.end()}catch{};await sdk.shutdown()}
process.stdin.on('data',async data=>{if(data.toString().trim()==='release'){for(const release of pending.splice(0))await release()}else if(data.toString().trim()==='stop'){await stop();process.exit(0)}})
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({event:'ready',origin:'http://127.0.0.1:'+server.address().port})+'\n'))
