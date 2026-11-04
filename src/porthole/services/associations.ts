export interface Association {
 kind:'infrastructure'|'database'|'messaging';system:string;target:string|null
 address:string|null;port:number|null;relation:'runs-on'|'calls'|'produces'|'consumes'
 observations:number;lastSeenNs:string;evidence:{traceId:string;spanId:string}
}
// Only explicit resource identities and semantic dependency attributes are
// projected. Connection strings, SQL statements and message bodies stay out.
const identity=(value:unknown)=>typeof value==='string'&&value.length<=240&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)?value:null
export function associations(resource:Record<string,unknown>,attrs:Record<string,unknown>,kind:number,end:bigint,evidence:Association['evidence']):Association[] {
 const result:Association[]=[],add=(row:Omit<Association,'observations'|'lastSeenNs'|'evidence'>)=>result.push({...row,observations:1,lastSeenNs:String(end),evidence})
 for(const [system,value]of [
  ['host',resource['host.id']??resource['host.name']],['container',resource['container.id']],
  ['kubernetes-pod',resource['k8s.pod.uid']??resource['k8s.pod.name']],['runtime-instance',resource['service.instance.id']],
 ])if(identity(value))add({kind:'infrastructure',system:String(system),target:identity(value),address:null,port:null,relation:'runs-on'})
 const address=identity(attrs['server.address']??attrs['net.peer.name']??attrs['net.peer.ip']),rawPort=Number(attrs['server.port']??attrs['net.peer.port']),port=Number.isInteger(rawPort)&&rawPort>0&&rawPort<=65535?rawPort:null
 const database=identity(attrs['db.system.name']??attrs['db.system'])
 if(kind===3&&database)add({kind:'database',system:database,target:identity(attrs['db.namespace']??attrs['db.name']),address,port,relation:'calls'})
 const messaging=identity(attrs['messaging.system'])
 if([3,4,5].includes(kind)&&messaging)add({kind:'messaging',system:messaging,target:identity(attrs['messaging.destination.name']??attrs['messaging.destination']),address,port,relation:kind===4?'produces':kind===5?'consumes':'calls'})
 return result
}
export function mergeAssociations(rows:Association[]) {
 const merged=new Map<string,Association>()
 for(const row of rows){
  const key=JSON.stringify([row.kind,row.system,row.target,row.address,row.port,row.relation]),prior=merged.get(key)
  if(prior){
   prior.observations+=row.observations
   if(BigInt(row.lastSeenNs)>BigInt(prior.lastSeenNs)||(row.lastSeenNs===prior.lastSeenNs&&JSON.stringify(row.evidence)<JSON.stringify(prior.evidence))){prior.lastSeenNs=row.lastSeenNs;prior.evidence=row.evidence}
  }
  else merged.set(key,{...row})
 }
 return [...merged.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row)
}
