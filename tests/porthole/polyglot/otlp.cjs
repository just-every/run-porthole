// One real local HTTP request, instrumented only with stock OpenTelemetry APIs.
// Load the exact official exporters/providers shipped with the pinned Node SDK.
const {createRequire}=require('node:module')
const sdkRequire=createRequire(require.resolve('@opentelemetry/sdk-node'))
const {NodeSDK}=require('@opentelemetry/sdk-node')
const {resourceFromAttributes}=sdkRequire('@opentelemetry/resources')
const {PeriodicExportingMetricReader}=sdkRequire('@opentelemetry/sdk-metrics')
const {BatchLogRecordProcessor}=sdkRequire('@opentelemetry/sdk-logs')
const grpc=require('@grpc/grpc-js'),{trace,metrics,logs}=require('@opentelemetry/api')
const {createServer}=require('node:http')
const transport=process.env.PORTHOLE_OTLP_PROTOCOL==='grpc'?'grpc':'proto'
const {OTLPTraceExporter}=sdkRequire('@opentelemetry/exporter-trace-otlp-'+transport)
const {OTLPMetricExporter}=sdkRequire('@opentelemetry/exporter-metrics-otlp-'+transport)
const {OTLPLogExporter}=sdkRequire('@opentelemetry/exporter-logs-otlp-'+transport)
const metadata=new grpc.Metadata();metadata.set('authorization','Bearer '+process.env.PORTHOLE_OTLP_SECRET)
const config=signal=>transport==='grpc'?{url:process.env.PORTHOLE_OTLP_ENDPOINT,metadata}:{url:process.env.PORTHOLE_OTLP_ENDPOINT+'/v1/'+signal,headers:{authorization:'Bearer '+process.env.PORTHOLE_OTLP_SECRET}}
const reader=new PeriodicExportingMetricReader({exporter:new OTLPMetricExporter(config('metrics')),exportIntervalMillis:60000})
const sdk=new NodeSDK({resource:resourceFromAttributes({'service.name':'synthetic-porthole-200','deployment.environment.name':'synthetic-porthole-201','team.name':'synthetic-porthole-202'}),traceExporter:new OTLPTraceExporter(config('traces')),metricReaders:[reader],logRecordProcessors:[new BatchLogRecordProcessor({exporter:new OTLPLogExporter(config('logs'))})]})
sdk.start()
const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/plain'});response.end('synthetic-porthole-1620')})
async function main(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 let traceId
 await trace.getTracer('synthetic-porthole-1621').startActiveSpan('synthetic-porthole-1622',async span=>{
  traceId=span.spanContext().traceId
  try {
   const response=await fetch('http://127.0.0.1:'+server.address().port)
   if(response.status!==200||await response.text()!=='synthetic-porthole-1620')throw Error('actual request failed')
   metrics.getMeter('synthetic-porthole-1621').createCounter('synthetic_porthole_1623').add(1,{'http.response.status_code':response.status})
   logs.getLogger('synthetic-porthole-1621').emit({severityNumber:9,severityText:'INFO',body:'synthetic-porthole-1624',attributes:{'http.response.status_code':response.status}})
  }finally{span.end()}
 })
 await reader.forceFlush();await sdk.shutdown()
 await new Promise(resolve=>server.close(resolve))
 process.stdout.write(JSON.stringify({traceId,transport})+'\n')
}
main().catch(async(error)=>{server.closeAllConnections?.();server.close();await sdk.shutdown().catch(()=>{});process.stderr.write(('Stock OpenTelemetry Node export failed: '+String(error.stack??error)+'\n').split(process.env.PORTHOLE_OTLP_SECRET).join('[redacted]').replace(/[A-Za-z0-9_-]{32,}/g,'[redacted]'));process.exitCode=1})
