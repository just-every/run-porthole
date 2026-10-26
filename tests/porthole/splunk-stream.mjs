import assert from 'node:assert/strict'
// Synthetic records only at the supplied-source boundary. Official SSE wire references:
// https://dev.splunk.com/observability/docs/signalflow/messages/stream_messages_specification/
// https://dev.splunk.com/observability/docs/signalflow/messages/information_messages_specification/
const record=(event,data,id)=>`event: ${event}\n${id?`id: ${id}\n`:''}${JSON.stringify(data,null,2).split('\n').map(line=>'data: '+line).join('\n')}\n\n`
export async function splunkStreamJourney({origin,cookie,capture,member,foreignCookie,selectedDefinitions,upload,finish,snapshot}){
 const route='/api/porthole/v1/migration/replay'
 const post=(body,session=cookie)=>fetch(origin+route,{method:'POST',headers:{origin,cookie:session,'content-type':'application/json'},body:JSON.stringify(body)})
 const scope={service:'checkout',environment:'test',team:'ops'},history=selectedDefinitions.history[0]
 const start=history.request.startMs,stop=history.request.endMS
 const definition={id:'synthetic-porthole-4380',name:'Captured source comparison',programText:"A = data('requests', filter=filter('service', 'checkout'), resolution=1000, extrapolation='null').mean(); detect(when(A > 10)).publish('high')",rules:[{detectLabel:'high',severity:'Major'}],tags:['definition-tag-only']}
 const valueTsId='synthetic-porthole-4381',eventTsId='synthetic-porthole-4382',incidentId='synthetic-porthole-4383'
 const metadata=tsId=>record('metadata',{tsId,properties:{jobId:'synthetic-porthole-4384',sf_metric:'high',sf_key:['service','environment','team','sf_metric'],...scope,sf_tags:['team:ops'],sf_resolutionMs:1000}})
 const body=record('control-message',{event:'STREAM_START',timestampMs:start})+record('control-message',{event:'JOB_START',handle:'synthetic-porthole-4384',timestampMs:start})+record('message',{logicalTimestampMs:start,message:{messageCode:'JOB_RUNNING_RESOLUTION',messageLevel:'INFO',timestampMs:start,contents:{resolutionMs:1000}}})+metadata(valueTsId)+metadata(eventTsId)+[6,16,6].map((value,index)=>record('data',{logicalTimestampMs:start+index*1000,data:[{tsId:valueTsId,value}]},`synthetic-porthole-${4390+index}`)+(index?record('event',{tsId:eventTsId,timestampMs:start+index*1000,properties:{incidentId,was:index===1?'ok':'anomalous',is:index===1?'anomalous':'ok',inputValues:JSON.stringify({A:value})}}):'')).join('')+record('control-message',{event:'END_OF_CHANNEL',timestampMs:stop})
 const stream={id:'synthetic-porthole-4385',source:'splunk-signalflow-stream',programText:definition.programText,request:{startMs:start,stopMs:stop,resolution:1000},capture:{transport:'sse',body},comparison:{valueTsId,eventTsId,label:'high',dimensions:scope,tags:['team:ops'],inputVariable:'A'}}
 const changed=(id,transform)=>({...stream,id,capture:{...stream.capture,body:transform(body)}})
 const wrongValue=changed('synthetic-porthole-4386',text=>text.replace('"value": 16','"value": 17'))
 const wrongTags=changed('synthetic-porthole-4387',text=>text.replaceAll('"team:ops"','"team:other"'))
 const wrongInput=changed('synthetic-porthole-4388',text=>text.replace('\\"A\\":16','\\"A\\":18'))
 const invalid=[
  changed('synthetic-porthole-4410',text=>text.slice(0,text.lastIndexOf('event: control-message'))),
  changed('synthetic-porthole-4411',text=>text.replace('END_OF_CHANNEL','CHANNEL_ABORT')),
  changed('synthetic-porthole-4412',text=>text.replace('event: data','event: unknown')),
  changed('synthetic-porthole-4413',text=>text.replace('synthetic-porthole-4391','synthetic-porthole-4390')),
  changed('synthetic-porthole-4414',text=>text.replace(incidentId,'invalid identity')),
  changed('synthetic-porthole-4415',text=>text.replace('JOB_RUNNING_RESOLUTION','UNKNOWN_INFORMATION')),
 ]
 const before=await snapshot(),plan=await upload('splunk',{history:[history],detectors:[definition],sourceStreams:[stream,wrongValue,wrongTags,wrongInput,...invalid]})
 assert.equal(plan.rejected.length,invalid.length)
 await finish('apply',{planId:plan.planId,reviewedFingerprint:plan.fingerprint},'splunk','completed')
 const rows=await snapshot(),find=(kind,id)=>rows.find(row=>row.targetKind===kind&&row.value.definition.id===id)
 const detector=find('detectors',definition.id),retainedHistory=find('history',history.id),retainedStream=find('sourceStreams',stream.id)
 assert.deepEqual(retainedStream.value.definition,stream,'capture bytes and original SSE field payloads remain unchanged')
 const input={...scope,from:String(BigInt(start)*1000000n),through:String(BigInt(stop)*1000000n),targetId:detector.targetId,targetRevision:detector.revision,historyId:retainedHistory.targetId,sourceStreamId:retainedStream.targetId}
 for(const [session,status]of [['',401],[member,403],[foreignCookie,401]])assert.equal((await post(input,session)).status,status)
 const response=await post(input);assert.equal(response.status,200,await response.clone().text())
 const replay=await response.json(),comparison=replay.sourceComparison
 assert.deepEqual(comparison.mismatches,[])
 assert.equal(comparison.compared.values,3);assert.equal(comparison.compared.transitions,2);assert.equal(comparison.compared.inputValues,2)
 assert.equal(comparison.fullLifecycleParity,'unqualified');assert.ok(comparison.unqualified.some(text=>text.includes('unknown')))
 assert.equal(replay.notifications,'inactive')
 for(const [source,code]of [[wrongValue,'value-mismatch'],[wrongTags,'source-value-declared-tags-mismatch'],[wrongInput,'event-input-value-mismatch']]){
  const mismatched=await post({...input,sourceStreamId:find('sourceStreams',source.id).targetId})
  assert.equal(mismatched.status,200,await mismatched.clone().text())
  const result=(await mismatched.json()).sourceComparison
  assert.equal(result.status,'mismatched');assert.ok(result.mismatches.some(item=>item.code===code),code)
 }
 const captureComparison=async(name,selection,expected)=>capture(name,'/app/import',async page=>{
  await page.getByText('Analyze retained metric samples',{exact:true}).click()
  const form=page.locator('form[action="/app/import/replay"]')
  await form.locator('[name=targetRef]').selectOption(JSON.stringify([input.targetId,input.targetRevision]))
  await form.locator('[name=historyId]').selectOption(input.historyId)
  await form.locator('[name=sourceStreamId]').selectOption(selection)
  for(const key of ['service','environment','team','from','through'])await form.locator(`[name=${key}]`).fill(input[key])
  if(expected==='form')return
  await form.getByRole('button',{name:'Analyze retained samples',exact:true}).click()
  await page.getByRole('heading',{name:'Retained sample replay',exact:true}).waitFor()
  await page.getByText('Exact replay data',{exact:true}).click()
  const result=JSON.parse(await page.locator('details pre').innerText());assert.deepEqual(result.sourceComparison,expected)
  await page.getByText('Exact replay data',{exact:true}).click()
 })
 await captureComparison('move-in-source-stream-form',input.sourceStreamId,'form')
 await captureComparison('move-in-source-stream-comparison',input.sourceStreamId,comparison)
 const mismatched=await (await post({...input,sourceStreamId:find('sourceStreams',wrongValue.id).targetId})).json()
 await captureComparison('move-in-source-stream-mismatch',find('sourceStreams',wrongValue.id).targetId,mismatched.sourceComparison)
 await finish('undo',{planId:plan.planId},'splunk','undone');assert.deepEqual(await snapshot(),before)
 assert.equal((await post(input)).status,404)
}
