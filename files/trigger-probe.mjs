import {pathToFileURL} from 'node:url'
import {writeFile} from 'node:fs/promises'
const root=process.cwd(),{recipientMailJourney}=await import(pathToFileURL(root+'/tests/porthole/health.mjs'))
const outcomes=[]
for(const door of ['capture','otlp'])for(const sample of ['private_tenant','private_tenant_orders'])await recipientMailJourney({run:async({cookie,call,post,getDb})=>{
 const read=async path=>(await call(path,{headers:{cookie}})).json(),send=async(path,data,status=200)=>(await post(path,data,status)).json()
 const scope={services:['synthetic-porthole-16020'],environments:['production'],teams:['commerce']},pipeline='/api/porthole/v1/pipelines',api='/api/porthole/v1/archive',db='/api/porthole/v1/database'
 const source=await send('/app/settings/credentials/mint',{name:'Synthetic export trigger',class:'ingest',scope:{...scope,signals:['logs','traces'],actions:['telemetry.write']}},201)
 const definition={service:scope.services[0],environment:'production',team:'commerce',processors:[],metrics:[],redaction:[{pattern:'private_tenant',exceptions:[]}]},preview=await send(pipeline+'/preview',{definition,samples:[],revision:(await read(pipeline)).revision},201)
 await send(pipeline+'/activate',{previewId:preview.id,digest:preview.digest,confirm:'activate-pipeline'},201)
 const statement='SELECT count(*) FROM '+sample+' WHERE customer = ?',now=Date.now()
 let path,body
 if(door==='capture'){
  const review=await send(db+'/sources',{id:'synthetic-porthole-16020',revision:0,credentialId:source.credential.id,engine:'mysql',service:scope.services[0],environment:'production',team:'commerce',plans:[],enabled:true,confirm:'review-read-only-database'},201)
  path=db+'/captures';body={id:review.id,revision:review.revision,planDigest:review.planDigest,capture:{engine:'mysql',version:'8.4.6',collectedAt:now,databaseTime:now,coverage:{plans:'not_reviewed',statistics:'collected',waits:'collected'},queries:[{queryId:'synthetic-porthole-16021',fingerprint:statement,calls:1,totalMs:1,meanMs:1,rows:1,plan:[]}],waits:[]}}
 }else{
  path='/v1/traces';body={resourceSpans:[{resource:{attributes:Object.entries({'service.name':scope.services[0],'deployment.environment.name':'production',team:'commerce'}).map(([key,stringValue])=>({key,value:{stringValue}}))},scopeSpans:[{scope:{name:'synthetic-porthole-16020'},spans:[{traceId:'1234567890abcdef1234567890abcdef',spanId:'1234567890abcdef',name:'synthetic-porthole-16021',kind:3,startTimeUnixNano:String(BigInt(now)*1000000n),endTimeUnixNano:String(BigInt(now+1)*1000000n),attributes:[{key:'db.system',value:{stringValue:'mysql'}},{key:'db.statement',value:{stringValue:statement}}]}]}]}]}
 }
 const intake=await call(path,{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':'application/json'},body:JSON.stringify(body)})
 await send('/api/porthole/v1/ingest/drain',{})
 const stored=(await getDb().prepare('SELECT records FROM porthole_ingest_batches').all()).results.map(row=>JSON.parse(row.records))
 const job=await send(api+'/exports',{},201),statuses=[];let failure=null
 for(let i=0;i<job.totalChunks;i++){const response=await call(`${api}/exports/${job.id}/chunks/${i}`,{headers:{cookie}});statuses.push(response.status);if(response.status!==200){failure=await response.json();break}}
 const manifest=await call(`${api}/exports/${job.id}/manifest`,{headers:{cookie}})
 outcomes.push({door,sample,statement,intakeStatus:intake.status,stored,chunkStatuses:statuses,failure,manifestStatus:manifest.status})
}})
const receipt={schema:1,phase:process.argv[2],outcomes}
await writeFile(process.argv[3],JSON.stringify(receipt,null,2)+'\n')
console.log(JSON.stringify(receipt))
