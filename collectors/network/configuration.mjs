// Generates configuration only. Every receiver and processor is stock Contrib.
export const component=(type,name)=>[type,name].join('/')
export const resourceAttributes=identity=>Object.entries({'service.name':identity.service,'deployment.environment.name':identity.environment,'team.name':identity.team,'container.id':identity.containerId,'host.id':identity.hostId,...(identity.brokerId?{'porthole.messaging.broker.container.id':identity.brokerId}:{})}).map(([key,value])=>({key,value,action:'upsert'}))
export function networkConfiguration({identity,exportEndpoint,sourceHeaders={},dockerSocket=true}) {
 return {
  receivers:{prometheus:{config:{scrape_configs:[{job_name:'namespace-netstat',scrape_interval:'2s',static_configs:[{targets:[identity.service+':9100']}],metric_relabel_configs:[{source_labels:['__name__'],regex:'node_netstat_Tcp_RetransSegs|node_netstat_TcpExt_TCPTimeouts',action:'keep'}]}]}},docker_stats:{endpoint:'unix:///var/run/docker.sock',api_version:'1.44',collection_interval:'2s',metrics:{'container.network.io.usage.rx_dropped':{enabled:true},'container.network.io.usage.tx_dropped':{enabled:true}}}},
  processors:{[component('resource','identity')]:{attributes:resourceAttributes(identity)},[component('filter','container')]:{error_mode:'propagate',metrics:{datapoint:[`resource.attributes["container.id"] != "${identity.containerId}"`]}},[component('filter','network')]:{error_mode:'propagate',metrics:{metric:['not IsMatch(name, "^container[.]network[.].*(dropped|errors)$")']}}},
  exporters:{otlphttp:{endpoint:exportEndpoint,encoding:'json',compression:'none',headers:sourceHeaders,retry_on_failure:{enabled:false}}},
  service:{telemetry:{logs:{level:'error'}},pipelines:{[component('metrics','tcp')]:{receivers:['prometheus'],processors:[component('resource','identity')],exporters:['otlphttp']},...(dockerSocket?{[component('metrics','container')]:{receivers:['docker_stats'],processors:[component('filter','container'),component('filter','network'),component('resource','identity')],exporters:['otlphttp']}}:{})}},
 }
}
