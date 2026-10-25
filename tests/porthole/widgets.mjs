import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form} from './fixture.mjs'

export async function widgetJourney({origin,cookie,scope,body,sourceSecret,restartWorker}) {
 const week=604800000000000n,prior=BigInt(body.range.from)-week
 const resource={attributes:Object.entries({'service.name':'checkout','deployment.environment.name':'production','team.name':'commerce'}).map(([key,stringValue])=>({key,value:{stringValue}}))}
 const intake=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:`Bearer ${sourceSecret}`,'content-type':'application/json'},body:JSON.stringify({resourceMetrics:[{resource,scopeMetrics:[{metrics:[{name:'checkout.cpu',unit:'%',gauge:{dataPoints:[10,20].map((asDouble,index)=>({timeUnixNano:String(prior+BigInt(index)),asDouble,attributes:[{key:'host.name',value:{stringValue:index?'checkout-b':'checkout-a'}}]}))}}]}]}]})})
 assert.equal(intake.status,200);assert.equal((await fetch(origin+'/api/porthole/v1/ingest/drain',form(origin,cookie,{}))).status,200)
 const kinds=['query_value','timeseries','table','top_list','distribution','heatmap','pie','treemap','list','log_stream','notes']
 const panels=kinds.map(widget=>({...body.panels[widget==='log_stream'||widget==='notes'?1:0],id:widget,title:'Checkout '+widget.replaceAll('_',' '),widget,...(widget==='timeseries'?{compareWeek:true}:{}),...(widget==='notes'?{note:'Release inspected\n<script>window.untrustedNote=true</script>'}:{})}))
 const metric=(name,values)=>({name,unit:'requests',gauge:{dataPoints:values.flatMap((samples,index)=>samples.map((asDouble,i)=>({timeUnixNano:String(BigInt(body.range.from)+[0n,250000000n,750000000n][i]),asDouble,attributes:[{key:'host.name',value:{stringValue:index?'checkout-b':'checkout-a'}}]})))}})
 const counters=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:`Bearer ${sourceSecret}`,'content-type':'application/json'},body:JSON.stringify({resourceMetrics:[{resource,scopeMetrics:[{metrics:[metric('checkout.counter',[[0,20,50],[0,10,40]]),metric('checkout.reset',[[40,10]])]}]}]})})
 assert.equal(counters.status,200);assert.equal((await fetch(origin+'/api/porthole/v1/ingest/drain',form(origin,cookie,{}))).status,200)
 const functions=[{kind:'rollup',seconds:1,operation:'sum'},{kind:'rank',limit:1},{kind:'smooth',window:2},{kind:'rate'}]
 panels.push(...functions.map(step=>({...body.panels[0],id:step.kind,title:'Checkout '+step.kind,widget:'table',metric:'checkout.counter',unit:'requests',functions:[step]})),{...body.panels[0],id:'reset',title:'Checkout reset',widget:'table',metric:'checkout.reset',unit:'requests',functions:[{kind:'rate'}]})
 for(const functions of [[{kind:'rank',limit:0}],[{kind:'divide',value:0}],[{kind:'rollup',seconds:0,operation:'sum'}],[{kind:'rate',scope:'other'}]]) {
  const rejected=await fetch(origin+'/api/porthole/v1/dashboards',form(origin,cookie,{name:'Refused function',scope,body:{...body,panels:[{...panels[0],functions}]}}));assert.equal(rejected.status,400)
 }
 const refusedSignal=await fetch(origin+'/api/porthole/v1/dashboards',form(origin,cookie,{name:'Refused log rate',scope,body:{...body,panels:[{...body.panels[1],functions:[{kind:'rate'}]}]}}));assert.equal(refusedSignal.status,400)
 const response=await fetch(origin+'/api/porthole/v1/dashboards' ,form(origin,cookie,{name:'Checkout widget comparison',scope,body:{...body,panels}}))
 assert.equal(response.status,201,await response.clone().text());const {id}=await response.json()
 await restartWorker()
 const persisted=await (await fetch(origin+'/api/porthole/v1/dashboards/'+id,{headers:{cookie}})).json();assert.deepEqual(persisted.body.panels.find(panel=>panel.id==='rate').functions,[{kind:'rate'}])
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();assert.equal((await page.goto(origin+'/app/dashboards/'+id)).status(),200)
  const panel=kind=>page.locator(`[data-panel="${kind}"]`)
  for(const kind of kinds)assert.equal(await panel(kind).count(),1)
  assert.match(await panel('query_value').innerText(),/30/)
  const values=async kind=>panel(kind).locator('tbody tr').evaluateAll(rows=>rows.map(row=>Number(row.cells[3].textContent)))
  assert.deepEqual(await values('rollup'),[70,50]);assert.deepEqual(await values('rank'),[0,20,50]);assert.deepEqual(await values('smooth'),[0,10,35,0,5,25]);assert.deepEqual(await values('rate'),[80,60,40,60])
  assert.match(await panel('rate').innerText(),/requests per second/);assert.match(await panel('reset').getByRole('status').innerText(),/counter decreased/);assert.equal(await panel('reset').locator('table').count(),0)
  assert.match(await panel('smooth').innerText(),/trailing mean of at most 2 observed samples per series/)
  const sourceLink=new URL(await panel('rate').getByRole('link',{name:'Open underlying metrics query'}).getAttribute('href'),origin);assert.equal(sourceLink.searchParams.get('from'),body.range.from);assert.equal(sourceLink.searchParams.get('metric'),'checkout.counter')
  // Save the actual function definition with the native keyboard editor.
  await page.getByText('Edit dashboard',{exact:true}).click();const edit=page.locator('form[action="/app/dashboards/save"]');const definition=JSON.parse(await edit.getByLabel('Dashboard JSON').inputValue());assert.deepEqual(definition.panels.find(panel=>panel.id==='smooth').functions,[{kind:'smooth',window:2}]);await edit.getByRole('button',{name:'Save new revision'}).focus();await page.keyboard.press('Enter');await page.waitForLoadState('networkidle');await page.reload();assert.deepEqual(await values('rate'),[80,60,40,60])
  assert.equal(await panel('timeseries').locator('svg').first().locator('circle').count(),2)
  assert.match(await panel('timeseries').getByRole('region',{name:'Previous UTC week'}).innerText(),/Previous value: 15/);assert.equal(await panel('timeseries').getByRole('region',{name:'Previous UTC week'}).locator('circle').count(),4)
  const priorLink=new URL(await page.getByRole('link',{name:'Open previous week source query'}).getAttribute('href'),origin);assert.equal(priorLink.searchParams.get('from'),String(prior));assert.equal(priorLink.searchParams.get('through'),String(BigInt(body.range.through)-week))
  assert.match(await panel('table').innerText(),/checkout-a/);assert.match(await panel('table').innerText(),/checkout-b/)
  for(const kind of ['distribution','heatmap'])assert.equal(await panel(kind).locator('rect[data-count]').evaluateAll(rows=>rows.reduce((total,row)=>total+Number(row.dataset.count),0)),2)
  for(const kind of ['top_list','pie','treemap','list']) {
   assert.equal(await panel(kind).locator('table[data-total]').getAttribute('data-total'),'60')
   assert.deepEqual(await panel(kind).locator('[data-series]').evaluateAll(rows=>rows.map(row=>Number(row.dataset.value))),[40,20])
  }
  assert.match(await panel('log_stream').innerText(),/Checkout dependency waiting/)
  assert.match(await panel('notes').innerText(),/<script>window.untrustedNote=true<\/script>/)
  assert.equal(await page.evaluate(()=>window.untrustedNote),undefined)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'widget page reflows with actual series identities')
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-widgets-${width}.png`),fullPage:true})}
  await page.getByLabel('team',{exact:true}).fill('payments');await page.getByLabel('environment',{exact:true}).fill('staging');await page.getByRole('button',{name:'Apply variables and range'}).click();assert.equal(await panel('rate').locator('tbody tr').count(),0);assert.match(await panel('rate').getByRole('status').first().innerText(),/empty/);assert.match(await page.getByRole('region',{name:'Previous UTC week'}).innerText(),/Previous value: No complete value/);assert.match(await page.getByRole('region',{name:'Previous UTC week'}).getByRole('status').innerText(),/empty/)
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-week-empty-${width}.png`),fullPage:true})
  await context.close()
 }}finally{await browser.close()}
 console.log('Widget functions passed: exact rollup, rank, smoothing and counter rate, schema and reset refusals, original source ranges, native edit and reload, restart and empty scopes at 1440 and 390')
 console.log('Widget journey passed: actual scalar values, exact timestamp lines, raw tables, ranked series, bin counts, proportional totals, source log bodies and escaped notes at both widths')
 return {id,panels}
}
