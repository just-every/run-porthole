// Expectations are enumerated independently of the parser and SQL compiler.
export const logSearchExpression='service:checkout @http.status_code:>=500 -status:info'
export const logSearchCases=[
 [logSearchExpression,[0,5,6]],
 ['service:checkout @http.status_code:>500',[1,5,6]],
 ['service:checkout @http.status_code:<=500',[0,2,7]],
 ['service:checkout @http.status_code:<500',[2,7]],
 ['service:checkout @http.status_code:500',[0]],
 ['service:checkout @http.status_code:"500"',[3]],
 ['service:checkout @http.status_code:[500 TO 599]',[0,1,5,6]],
 ['service:checkout @http.status_code:{500 TO 599}',[1,5]],
 ['service:checkout @http.status_code:[500 TO *]',[0,1,5,6]],
 ['service:checkout (status:error OR status:warn) -@http.status_code:500',[2,3,4,5,6,8]],
 ['service:checkout NOT @http.status_code:*',[4]],
 ['service:checkout -@http.status_code:>=500',[2,3,4,7,8]],
 ['service:checkout @http.status_code:*',[0,1,2,3,5,6,7,8]],
 ['service:checkout host:checkout-*',[0,1,2,3,4,6,7,8]],
 ['service:checkout host:checkout-?',[0,1,2,3,4,6,7,8]],
 ['service:checkout @payment.note:"payment: retry"',[5]],
 [String.raw`service:checkout @payment.note:payment\:\ retry`,[5]],
 [String.raw`service:checkout @literal:star\*value`,[5]],
 ['service:checkout @literal:star*',[5,6]],
 ['service:checkout @payment.enabled:true',[5]],
 ['service:checkout @http.status_code:true',[8]],
 ['service:checkout @payment.latency:>=12.5',[5]],
 ['service:checkout env:log-search team:commerce status:INFO',[1,7]],
 ['service:checkout (@http.status_code:404 OR (@http.status_code:>=500 AND -status:info))',[0,2,5,6]],
]
const text=stringValue=>({stringValue})
const number=value=>Number.isInteger(value)?{intValue:String(value)}:{doubleValue:value}
const attr=(key,value)=>({key,value})
export function logSearchPacket(time) {
 const statuses=[500,503,404,'500',undefined,501,599,200,true,503,503]
 const severity=['ERROR','INFO','WARN','ERROR','ERROR','ERROR','WARN','INFO','ERROR','ERROR','ERROR']
 return {resourceLogs:statuses.map((status,index)=>{
  const resource={attributes:[attr('service.name',text(index===9?'billing':'checkout')),attr('deployment.environment.name',text('log-search')),attr('team.name',text(index===10?'payments':'commerce')),attr('host.name',text(index===5?'edge-x':'checkout-'+(index===6?'z':['a','b','c','a','a'][index%5])))]}
  const attributes=[attr('corpus.id',text('synthetic-porthole-'+(2000+index)))]
  if(status!==undefined){
   const value=typeof status==='number'?number(status):typeof status==='boolean'?{boolValue:status}:text(status)
   attributes.push(index%2?attr('http.status_code',value):attr('http',{kvlistValue:{values:[attr('status_code',value)]}}))
  }
  if(index===5)attributes.push(attr('payment',{kvlistValue:{values:[attr('note',text('payment: retry')),attr('enabled',{boolValue:true}),attr('latency',number(12.5))]}}),attr('literal',text('star*value')))
  if(index===6)attributes.push(attr('literal',text('starship')))
  return {resource,scopeLogs:[{logRecords:[{timeUnixNano:String(BigInt(time)+BigInt(index)),severityText:severity[index],severityNumber:severity[index]==='ERROR'?17:severity[index]==='WARN'?13:9,body:text('Checkout payment observation '+index),attributes}]}]}
 })}
}
