import assert from 'node:assert/strict'

// A native catalog journey. These expectations are deliberately not described
// as authorized Datadog source results.
export async function pipelineProcessors({post,value,preview,activate,send,get,d,at}) {
 const agent=['Firefox','120.0'].join(String.fromCharCode(47))+' (Linux)'
 const definition={...d,exclude:undefined,processors:[
  {type:'json'},
  {type:'grok',source:'line',target:'parsed',pattern:'%{word:action} %{integer:units}'},
  {type:'remap',from:'message',to:'original',removeSource:true},
  {type:'status',source:'level'},
  {type:'category',target:'category',categories:[{name:'failure',field:'status',equals:'error'},{name:'normal',field:'status',equals:'info'}]},
  {type:'lookup',source:'region',target:'region.name',version:'revision-1',table:{us:'United States'}},
  {type:'url',source:'url',target:'url.details'},
  {type:'user-agent',source:'agent',target:'agent.details'},
  {type:'arithmetic',target:'total',expression:'quantity * price + 8 / divisor - -discount'},
  {type:'arithmetic',target:'extended',left:'quantity',operator:'*',right:'price'},
  {type:'enrich',values:{reviewed:true,optional:null}},
  {type:'route',field:'status',equals:'error',destination:'protected-errors'}
 ]}
 const base={message:'Checkout catalog',level:'info',line:'Checkout 7',region:'us',url:'https://example.invalid/checkout?q=cart#paid',agent,quantity:4,price:3,divisor:2,discount:1}
 const cases=[
  {input:base,total:17,errors:[]},
  {input:{...base,level:'error'},total:17,errors:[]},
  {input:{...base,divisor:0},errors:[{processor:8,code:'arithmetic_divide_by_zero'}]},
  {input:{...base,quantity:null},errors:[{processor:8,code:'arithmetic_operand_type'},{processor:9,code:'arithmetic_operand_type'}]},
  {input:{...base,line:'Checkout broken'},total:17,errors:[{processor:1,code:'grok_no_match'}]},
  {input:{...base,region:'unknown'},total:17,errors:[{processor:5,code:'lookup_miss'}]},
  {input:{...base,level:'unexpected'},total:17,errors:[{processor:3,code:'status_unmapped'}]},
  {input:{...base,price:2,discount:0},total:12,extended:8,errors:[]},
  {input:{...base,quantity:0,discount:-1},total:3,extended:0,errors:[]},
  {input:{...base,line:'Café -7'},total:17,action:'Café',units:-7,errors:[]}
 ]
 const samples=Array.from({length:120},(_,i)=>JSON.stringify(cases[i%cases.length].input))
 const expected=cases.map(c=>{
  const attributes={...c.input,original:c.input.message,'agent.details.browser':'Firefox','agent.details.version':'120.0','agent.details.os':'Linux','agent.details.device':'unknown','url.details.scheme':'https','url.details.host':'example.invalid','url.details.port':'','url.details.path':'/checkout','url.details.query':'q=cart','url.details.fragment':'paid',reviewed:true,optional:null}
  delete attributes.message
  if(!c.errors.some(e=>e.processor===1)){attributes['parsed.action']=c.action??'Checkout';attributes['parsed.units']=c.units??7}
  if(c.input.level!=='unexpected'){attributes.status=c.input.level;attributes.category=c.input.level==='error'?'failure':'normal'}
  if(c.input.level==='error')attributes['route.destination']='protected-errors'
  if(c.input.region==='us')attributes['region.name']='United States'
  if(c.total!==undefined)attributes.total=c.total
  if(c.input.quantity!==null)attributes.extended=c.extended??12
  return {attributes,errors:c.errors,status:c.errors.length?'error':'ok'}
 })
 const compare=(result,index,accepted=false)=>{
  const e=expected[index%cases.length]
  const attributes=accepted?{...e.attributes,'service.name':d.service,'team.name':d.team,'deployment.environment.name':d.environment,'nested-private':'[REDACTED]','synthetic-porthole-207':String(index)}:e.attributes
  assert.deepEqual(result.attributes,attributes,'native processor values and types at record '+index)
  assert.deepEqual(result.errors,e.errors,'native diagnostic policy at record '+index)
  assert.equal(result.status,e.status)
  assert.equal(result.protected,e.errors.length>0||cases[index%cases.length].input.level==='error')
 }
 for(let start=0;start<samples.length;start+=30){
  const p=await preview(definition,samples.slice(start,start+30))
  p.results.forEach((result,index)=>compare(result,start+index))
 }
 for(const expression of ['quantity +','quantity ** 2','constructor + 1','('.repeat(40)+'1'+')'.repeat(40)]){
  const current=await get('/api/porthole/v1/pipelines')
  const response=await post('/api/porthole/v1/pipelines/preview',{definition:{...d,processors:[{type:'arithmetic',target:'total',expression}]},samples:[],revision:current.revision})
  assert.equal(response.status,400,'invalid expressions refuse before activation')
 }
 await activate(await preview(definition,[]))
 await send(samples,'synthetic-porthole-12300',at)
 await value(await post('/api/porthole/v1/ingest/drain',{}))
 const query={signal:'logs',service:d.service,environment:d.environment,team:d.team,from:String(at),through:String(at+1000n),limit:200}
 const selected=[];let cursor,snapshot
 do {
  const page=await value(await post('/api/porthole/v1/query',{...query,...(cursor?{cursor,snapshot}:{})}))
  selected.push(...page.records);cursor=page.cursor;snapshot=page.snapshot
 }while(cursor)
 assert.equal(selected.length,samples.length)
 selected.forEach((record,index)=>compare(record.payload.pipeline,Number(record.payload.pipeline.attributes['synthetic-porthole-207']),true))
 console.log('pipelineProcessors passed: 120 native inputs through preview, activation, intake and paginated query; source comparison remains unqualified')
}
