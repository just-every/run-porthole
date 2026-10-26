import {identity,numeric,object,timestamp,strings,type SourceObject,type StreamMessage} from './types'
const infoCodes=['JOB_RUNNING_RESOLUTION','JOB_DETECTED_LAG','FIND_MATCHED_NO_TIMESERIES','FIND_LIMITED_RESULT_SET','FIND_MATCHED_DIMENSIONS','FETCH_NUM_TIMESERIES','WINDOW_RESIZED','GROUPBY_MISSING_PROPERTY']
/** Official SSE shapes: https://dev.splunk.com/observability/docs/signalflow/messages/stream_messages_specification/ */
export function validateMessages(messages:StreamMessage[]){
 const metadata:Record<string,SourceObject>=Object.create(null),active=new Set<string>(),points=new Set<string>(),eventsSeen=new Set<string>(),incidents=new Map<string,string>(),lastData=new Map<string,number>(),lastEvent=new Map<string,number>()
 const data:StreamMessage[]=[],events:StreamMessage[]=[],info:StreamMessage[]=[]
 let started=false,job=false,ended=false,resolutionMs:number|undefined
 for(const [index,record]of messages.entries()){
  const m=record.data
  if(ended)throw Error('Source messages follow END_OF_CHANNEL')
  if(record.event==='control-message'){
   if(!timestamp(m.timestampMs))throw Error('Malformed control timestamp')
   if(m.event==='CHANNEL_ABORT')throw Error('Source computation aborted: CHANNEL_ABORT')
   if(m.event==='STREAM_START'){if(started||index!==0)throw Error('Duplicate or misplaced STREAM_START');started=true}
   else if(m.event==='JOB_START'){if(!started||job||!identity(m.handle))throw Error('Duplicate or malformed JOB_START handle');job=true}
   else if(m.event==='JOB_PROGRESS'){if(!job||!Number.isInteger(m.progress)||Number(m.progress)<0||Number(m.progress)>100)throw Error('Malformed JOB_PROGRESS')}
   else if(m.event==='END_OF_CHANNEL'){if(!job)throw Error('END_OF_CHANNEL without initialized job');ended=true}
   else throw Error('Unknown source control event: '+String(m.event))
   continue
  }
  if(!job)throw Error('Source message precedes JOB_START')
  if(record.event==='metadata'){
   if(!identity(m.tsId)||Object.hasOwn(metadata,m.tsId)||!object(m.properties))throw Error('Duplicate or malformed metadata tsId')
   if(m.properties.sf_tags!==undefined&&!strings(m.properties.sf_tags))throw Error('Malformed source metadata tags')
   if(m.properties.sf_key!==undefined&&!strings(m.properties.sf_key))throw Error('Malformed source metadata dimension keys')
   metadata[m.tsId]=m.properties;active.add(m.tsId)
  }else if(record.event==='expired-tsid'){
   if(!identity(m.tsId)||!active.has(m.tsId))throw Error('Unknown or duplicate expired tsId');active.delete(m.tsId)
  }else if(record.event==='data'){
   if(!timestamp(m.logicalTimestampMs)||!Array.isArray(m.data))throw Error('Malformed source data batch')
   for(const point of m.data){
    if(!object(point)||!identity(point.tsId)||!active.has(point.tsId)||!numeric(point.value))throw Error('Source data needs prior metadata, exact tsId and finite value')
    const key=JSON.stringify([point.tsId,m.logicalTimestampMs])
    if(points.has(key)||Number(m.logicalTimestampMs)<(lastData.get(point.tsId)??-1))throw Error('Duplicate or unordered source data timestamp for tsId')
    points.add(key);lastData.set(point.tsId,m.logicalTimestampMs)
   }
   data.push(record)
  }else if(record.event==='event'){
   const p=m.properties
   if(!identity(m.tsId)||!active.has(m.tsId)||!timestamp(m.timestampMs)||!object(p)||!identity(p.incidentId)||!['ok','anomalous'].includes(String(p.was))||!['ok','anomalous'].includes(String(p.is))||p.was===p.is||typeof p.inputValues!=='string')throw Error('Malformed source event: tsId, incidentId, timestamp, was and is and original inputValues are required')
   let inputs:unknown;try{inputs=JSON.parse(p.inputValues)}catch{throw Error('Malformed source event inputValues JSON')}
   if(!object(inputs)||Object.values(inputs).some(value=>!numeric(value)))throw Error('Unqualified source event inputValues: finite numeric variable map required')
   const key=JSON.stringify([m.tsId,m.timestampMs]),owner=incidents.get(p.incidentId)
   if(eventsSeen.has(key)||m.timestampMs<=(lastEvent.get(m.tsId)??-1)||owner!==undefined&&owner!==m.tsId)throw Error('Duplicate, unordered or conflicting source event and incident identity')
   eventsSeen.add(key);incidents.set(p.incidentId,m.tsId);lastEvent.set(m.tsId,m.timestampMs);events.push(record)
  }else if(record.event==='message'){
   const message=m.message
   if(!timestamp(m.logicalTimestampMs)||!object(message)||!timestamp(message.timestampMs)||!infoCodes.includes(String(message.messageCode))||!['INFO','WARNING','ERROR'].includes(String(message.messageLevel)))throw Error('Unknown or malformed source information message')
   if(message.messageCode==='JOB_RUNNING_RESOLUTION'){
    if(!object(message.contents)||!Number.isSafeInteger(message.contents.resolutionMs)||Number(message.contents.resolutionMs)<=0)throw Error('Malformed source job resolution')
    if(resolutionMs!==undefined&&resolutionMs!==message.contents.resolutionMs)throw Error('Changing source job resolution remains unqualified')
    resolutionMs=Number(message.contents.resolutionMs)
   }
   if(message.messageLevel==='ERROR')throw Error('Source information reports an error')
   info.push(record)
  }else throw Error('Unknown source SSE event: '+record.event)
 }
 if(!ended)throw Error('Incomplete source stream: END_OF_CHANNEL is required')
 if(!resolutionMs)throw Error('Source job resolution is unknown: JOB_RUNNING_RESOLUTION is required')
 return {metadata,data,events,info,resolutionMs}
}
