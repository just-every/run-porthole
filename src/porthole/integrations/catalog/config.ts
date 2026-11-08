import {packFor,type Binding} from './model'
/** All connection and credential values are resolved only by the stock collector.
 * JSON is a YAML subset. No monitored-service value is accepted by this door. */
export function collectorConfiguration(b:Binding,origin:string) {
 const p=packFor(b.pack),value=(name:string)=>'${env:'+name+'}',prefix='PORTHOLE_'+b.pack.toUpperCase(),endpoint=value(prefix+'_ENDPOINT')
 const receiver:Record<string,unknown>={collection_interval:'5s'}
 if(b.pack==='kafka')Object.assign(receiver,{brokers:[endpoint],protocol_version:'3.9.0',scrapers:['brokers','topics','consumers'],auth:{sasl:{username:value(prefix+'_USERNAME'),password:value(prefix+'_PASSWORD'),mechanism:'PLAIN'}}})
 else if(b.pack==='mongodb')Object.assign(receiver,{hosts:[{endpoint}],username:value(prefix+'_USERNAME'),password:value(prefix+'_PASSWORD'),tls:{insecure:true}})
 else {receiver.endpoint=endpoint
  if(!['nginx','redis'].includes(b.pack))Object.assign(receiver,{username:value(prefix+'_USERNAME'),password:value(prefix+'_PASSWORD')})
  if(b.pack==='redis')Object.assign(receiver,{username:value(prefix+'_USERNAME'),password:value(prefix+'_PASSWORD')})
  if(b.pack==='mysql')receiver.metrics=p.receiverMetrics
  if(b.pack==='postgresql')Object.assign(receiver,{databases:[value(prefix+'_DATABASE')],tls:{insecure:true},metrics:{'postgresql.database.locks':{enabled:false}}})
 }
 const self='prometheus',receivers:Record<string,unknown>={[p.receiver]:receiver,[self]:{config:{scrape_configs:[{job_name:'collector',scrape_interval:'2s',static_configs:[{targets:['127.0.0.1:'+value('PORTHOLE_SELF_PORT')]}],metric_relabel_configs:[{source_labels:['__name__'],regex:'otelcol_(scraper_.*|fileconsumer_.*)',action:'keep'}]}]}}}
 receivers['filelog']={include:[value('PORTHOLE_DIAGNOSTIC_LOG')],start_at:'beginning',storage:'file_storage',operators:[{type:'filter',expr:'body not matches "Error scraping metrics"'}]}
 const diagnosticStatements=[
  'set(attributes["porthole.setup.failure"], "receiver_failed")',
  'set(attributes["porthole.setup.failure"], "endpoint_unavailable") where IsMatch(body, "(?i)connection refused|no such host|deadline exceeded|timed out")',
  'set(attributes["porthole.setup.failure"], "authentication_denied") where IsMatch(body, "(?i)password authentication failed|Access denied|WRONGPASS|authentication failed|Unauthorized|401|Account is locked")',
  'set(attributes["porthole.setup.failure"], "permission_denied") where IsMatch(body, "(?i)permission denied|NOPERM|not authorized|authorization failed|403|not have access")',
  'set(body, "Collector receiver setup diagnostic; raw endpoint and error details remain on the collector host.")',
  'keep_keys(attributes, ["porthole.setup.failure"])',
 ]
 const attributes=Object.entries({'service.name':b.service,'deployment.environment.name':b.environment,'team.name':b.team,'porthole.integration.id':b.id,'porthole.integration.pack':b.pack}).map(([key,value])=>({key,value,action:'upsert'}))
 const metricRefusal='not ('+p.metrics.map(m=>'name == '+JSON.stringify(m.name)).join(' or ')+' or IsMatch(name, "^otelcol_(scraper_|fileconsumer_)"))'
 const pipelines:Record<string,unknown>={'logs':{receivers:['filelog'],processors:['transform','resource'],exporters:['otlphttp']},metrics:{receivers:[p.receiver,self],processors:['filter','resource'],exporters:['otlphttp']}}
 if(b.pack==='nginx') {
  const nginxLogs=['filelog','nginx'].join(String.fromCharCode(47))
  receivers[nginxLogs]={polls_to_archive:100000,include:[value('PORTHOLE_NGINX_ACCESS_LOG'),value('PORTHOLE_NGINX_ERROR_LOG')],start_at:'beginning',storage:'file_storage',include_file_path:true}
  pipelines[['logs','nginx'].join(String.fromCharCode(47))]={receivers:[nginxLogs],processors:['resource'],exporters:['otlphttp']}
 }
 return {extensions:{'file_storage':{directory:value('PORTHOLE_STATE_DIR'),create_directory:true}},receivers,processors:{'filter':{error_mode:'propagate',metrics:{metric:[metricRefusal]}},'resource':{attributes},'transform':{error_mode:'propagate',log_statements:[{context:'log',statements:diagnosticStatements}]}},exporters:{'otlphttp':{endpoint:origin,encoding:'json',compression:'none',headers:{Authorization:'Bearer '+value('PORTHOLE_INGEST_TOKEN')}}},service:{extensions:['file_storage'],telemetry:{logs:{level:'info',encoding:'json',disable_stacktrace:true,output_paths:[value('PORTHOLE_DIAGNOSTIC_LOG')]},metrics:{level:'detailed',readers:[{pull:{exporter:{prometheus:{host:'127.0.0.1',port:value('PORTHOLE_SELF_PORT')}}}}]}},pipelines}}
}
