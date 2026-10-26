const {createRequire}=require('node:module')
const sdkRequire=createRequire(require.resolve('@opentelemetry/sdk-node'))
const {NodeSDK}=require('@opentelemetry/sdk-node')
const {resourceFromAttributes}=sdkRequire('@opentelemetry/resources')
const {BatchLogRecordProcessor}=sdkRequire('@opentelemetry/sdk-logs')
const {OTLPLogExporter}=sdkRequire('@opentelemetry/exporter-logs-otlp-proto')
const {OTLPTraceExporter}=sdkRequire('@opentelemetry/exporter-trace-otlp-proto')
const {trace,logs}=require('@opentelemetry/api')
const {createServer}=require('node:http')
const config=signal=>({url:process.env.PORTHOLE_OTLP_ENDPOINT+'/v1/'+signal,headers:{authorization:'Bearer '+process.env.PORTHOLE_OTLP_SECRET}})
const sdk=new NodeSDK({resource:resourceFromAttributes({'service.name':'synthetic-porthole-4380','deployment.environment.name':'synthetic-porthole-4381','team.name':'synthetic-porthole-4382'}),traceExporter:new OTLPTraceExporter(config('traces')),logRecordProcessors:[new BatchLogRecordProcessor({exporter:new OTLPLogExporter(config('logs'))})]})
const server=createServer((_request,response)=>{response.writeHead(200);response.end('synthetic-porthole-4383')})
sdk.start()
async function main(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const start=BigInt(process.env.PORTHOLE_SPL_START_NS)
 let traceId
 await trace.getTracer('synthetic-porthole-4384').startActiveSpan('synthetic-porthole-4385',async span=>{
  traceId=span.spanContext().traceId
  try{
   const response=await fetch('http://127.0.0.1:'+server.address().port)
   if(response.status!==200||await response.text()!=='synthetic-porthole-4383')throw Error('actual request failed')
   // The actual request supplies the log content; explicit fixture timestamps
   // exercise the inclusive earliest and exclusive latest source boundaries.
   for(let index=0;index<203;index++){
    const ns=index===0?start:index===202?start+1000000000n:start+500000000n
    logs.getLogger('synthetic-porthole-4384').emit({timestamp:[Number(ns/1000000000n),Number(ns%1000000000n)],severityNumber:9,severityText:'INFO',body:'synthetic-porthole-4386',attributes:{'http.response.status_code':response.status,'synthetic-porthole-4387':index}})
   }
  }finally{span.end()}
 })
 await sdk.shutdown();await new Promise(resolve=>server.close(resolve))
 process.stdout.write(JSON.stringify({traceId})+'\n')
}
main().catch(async error=>{
 server.closeAllConnections?.();server.close();await sdk.shutdown().catch(()=>{})
 process.stderr.write(String(error.stack??error).split(process.env.PORTHOLE_OTLP_SECRET).join('[redacted]')+'\n');process.exitCode=1
})
