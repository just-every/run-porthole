// Load before the application imports node:http, node:https or @grpc/grpc-js.
// Export authentication stays in the process environment, never in source.
const {NodeSDK}=require('@opentelemetry/sdk-node')
const {OTLPTraceExporter}=require('@opentelemetry/exporter-trace-otlp-proto')
const {HttpInstrumentation}=require('@opentelemetry/instrumentation-http')
const {GrpcInstrumentation}=require('@opentelemetry/instrumentation-grpc')
const {KafkaJsInstrumentation}=require('@opentelemetry/instrumentation-kafkajs')
const sdk=new NodeSDK({traceExporter:new OTLPTraceExporter(),instrumentations:[new HttpInstrumentation(),new GrpcInstrumentation(),new KafkaJsInstrumentation()]})
sdk.start()
module.exports=sdk
