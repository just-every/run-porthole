import {resourceAttributes,component} from '../network/configuration.mjs'
export function messagingConfiguration({identity,consumerIdentity,system,exportEndpoint,sourceHeaders={}}) {
 if(!['kafka','rabbitmq'].includes(system))throw Error('unsupported_native_messaging_system')
 const kafka=system==='kafka'
 if(typeof identity.destination!=='string'||!identity.destination||kafka&&typeof identity.group!=='string'||!kafka&&typeof identity.vhost!=='string')throw Error('explicit_broker_namespace_and_destination_required')
 const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 return {
  receivers:kafka?{kafkametrics:{brokers:['kafka:9092'],protocol_version:'3.0.0',topic_match:'^'+escaped(identity.destination)+'$',group_match:'^'+escaped(identity.group)+'$',scrapers:['topics','consumers'],collection_interval:'2s',auth:{sasl:{username:'reader',password:'${env:KAFKA_READER_PASSWORD}',mechanism:'PLAIN'}}}}:{rabbitmq:{endpoint:'http://rabbit:15672',username:'monitor',password:'${env:RABBITMQ_MONITOR_PASSWORD}',collection_interval:'2s'}},
  processors:{[component('filter','selected')]:{error_mode:'propagate',metrics:{...(!kafka?{datapoint:[`resource.attributes["rabbitmq.vhost.name"] != ${JSON.stringify(identity.vhost)} or resource.attributes["rabbitmq.queue.name"] != ${JSON.stringify(identity.destination)}`]}:{}),metric:[kafka?'not IsMatch(name, "^kafka[.](consumer_group[.](lag|offset)|partition[.]current_offset)$")':'not IsMatch(name, "^rabbitmq[.]message[.](current|published|delivered|acknowledged)$")']}},[component('resource','identity')]:{attributes:resourceAttributes(identity)},...(consumerIdentity?{[component('resource','consumer')]:{attributes:resourceAttributes(consumerIdentity)}}:{})},
  exporters:{otlphttp:{endpoint:exportEndpoint,encoding:'json',compression:'none',headers:sourceHeaders,retry_on_failure:{enabled:false}}},
  service:{telemetry:{logs:{level:'error'}},pipelines:{metrics:{receivers:[kafka?'kafkametrics':'rabbitmq'],processors:[component('filter','selected'),component('resource','identity')],exporters:['otlphttp']},...(consumerIdentity?{[component('metrics','consumer')]:{receivers:[kafka?'kafkametrics':'rabbitmq'],processors:[component('filter','selected'),component('resource','consumer')],exporters:['otlphttp']}}:{})}},
 }
}
