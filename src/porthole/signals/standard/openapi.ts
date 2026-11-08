import { failures } from '../../api/openapi-common'
const security=[{ScopedCredential:[]}]
export const standardPaths={
 '/api/v1/read':{post:{summary:'Bounded Prometheus remote-read v1 SAMPLES',security,
 description:'Raw Snappy protobuf with inclusive millisecond range and label matchers. Existing telemetry.read only; live scope, custody, quotas, erasure and portable exclusions apply. No PromQL evaluation. Unsupported metric mapping or exhausted scan refuses the whole result. Maximum 2000 scanned records, 1 MiB and 8 queries. See the standard signal API guide for the pinned mapping profile.',
 parameters:[{name:'Content-Encoding',in:'header',required:true,schema:{const:'snappy'}},{name:'X-Prometheus-Remote-Read-Version',in:'header',required:true,schema:{const:'0.1.0'}}],
 requestBody:{required:true,content:{'application/x-protobuf':{schema:{type:'string',format:'binary',description:'prometheus.ReadRequest'}}}},
 responses:{200:{description:'Snappy-compressed prometheus.ReadResponse using SAMPLES',content:{'application/x-protobuf':{schema:{type:'string',format:'binary'}}}},...failures([400,401,403,405,409,413,415,422,429,503])}}},
 '/api/traces/{traceID}':{get:{summary:'Bounded Tempo 2.8.2 trace-by-ID v1',security,
 description:'Authorized retained OTLP spans only. Every response explicitly declares partial trace evidence in headers; connected topology does not imply complete original trace. No search or TraceQL.',
 parameters:[{name:'traceID',in:'path',required:true,schema:{type:'string',pattern:'^[a-fA-F0-9]{32}$'}},...['start','end'].map(name=>({name,in:'query',schema:{type:'integer',minimum:0},description:'Optional paired inclusive Unix-second bounds.'}))],
 responses:{200:{description:'Tempo Trace, with OTLP ResourceSpans in batches',headers:{'X-Porthole-Trace-Completeness':{schema:{const:'partial'}},'X-Porthole-Trace-Evidence':{schema:{type:'string'}}},content:{'application/json':{schema:{type:'object',properties:{batches:{type:'array',items:{type:'object'}}}}},'application/protobuf':{schema:{type:'string',format:'binary'}}}},...failures([400,401,403,404,405,406,409,422,429,503])}}},
}
