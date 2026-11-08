import {packFor,type Binding} from './model'
/** All connection and credential values are resolved only by the stock collector.
 * JSON is a YAML subset. No monitored-service value is accepted by this door. */
export function collectorConfiguration(b:Binding,origin:string) {
 const p=packFor(b.pack),value=(name:string)=>'${env:'+name+'}',prefix='PORTHOLE_'+b.pack.toUpperCase(),endpoint=value(prefix+'_ENDPOINT')
 const receiver:Record<string,unknown>={collection_interval:'5s'}
 if(b.pack==='kafka')Object.assign(receiver,{brokers:[endpoint],protocol_version:'3.9.0',scrapers:['brokers','topics','consumers'],auth:{sasl:{username:value(prefix+'_USERNAME'),password:value(prefix+'_PASSWORD'),mechanism:'PLAIN'}}})
 else if(b.pack==='mongodb')Object.assign(receiver,{hosts:[{endpoint,transport:'tcp'}],username:value(prefix+'_USERNAME'),password:value(prefix+'_PASSWORD'),tls:{insecure:true}})
 else {receiver.endpoint=endpoint
  if(!['nginx','redis'].includes(b.pack))Object.assign(receiver,{username:value(prefix+'_USERNAME'),password:value(prefix+'_PASSWORD')})
  if(b.pack==='redis')Object.assign(receiver,{username:value(prefix+'_USERNAME'),password:value(prefix+'_PASSWORD')})
  if(b.pack==='postgresql')Object.assign(receiver,{databases:[value(prefix+'_DATABASE')],tls:{insecure:true},metrics:{'postgresql.database.locks':{enabled:false}}})
 }
 const self='prometheus/collector',receivers:Record<string,unknown>={[p.receiver]:receiver,[self]:{config:{scrape_configs:[{job_name:'collector',scrape_interval:'5s',static_configs:[{targets:['127.0.0.1:'+value('PORTHOLE_SELF_PORT')]}]}]}}}
 const attributes=Object.entries({'service.name':b.service,'deployment.environment.name':b.environment,'team.name':b.team,'porthole.integration.id':b.id,'porthole.integration.pack':b.pack}).map(([key,value])=>({key,value,action:'upsert'}))
 const pipelines:Record<string,unknown>={metrics:{receivers:[p.receiver,self],processors:['resource/scope'],exporters:['otlphttp/porthole']}}
 if(b.pack==='nginx') {
  receivers['filelog/nginx']={include:[value('PORTHOLE_NGINX_ACCESS_LOG'),value('PORTHOLE_NGINX_ERROR_LOG')],start_at:'beginning',include_file_path:true}
  pipelines.logs={receivers:['filelog/nginx'],processors:['resource/scope'],exporters:['otlphttp/porthole']}
 }
 return {receivers,processors:{'resource/scope':{attributes}},exporters:{'otlphttp/porthole':{endpoint:origin,encoding:'json',compression:'none',headers:{Authorization:'Bearer '+value('PORTHOLE_INGEST_TOKEN')}}},service:{telemetry:{logs:{level:'error'},metrics:{level:'detailed',readers:[{pull:{exporter:{prometheus:{host:'127.0.0.1',port:value('PORTHOLE_SELF_PORT')}}}}]}},pipelines}}
}
