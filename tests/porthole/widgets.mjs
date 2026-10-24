import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form} from './fixture.mjs'

export async function widgetJourney({origin,cookie,scope,body,sourceSecret}) {
 const week=604800000000000n,prior=BigInt(body.range.from)-week
 const resource={attributes:Object.entries({'service.name':'checkout','deployment.environment.name':'production','team.name':'commerce'}).map(([key,stringValue])=>({key,value:{stringValue}}))}
 const intake=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:`Bearer ${sourceSecret}`,'content-type':'application/json'},body:JSON.stringify({resourceMetrics:[{resource,scopeMetrics:[{metrics:[{name:'checkout.cpu',unit:'%',gauge:{dataPoints:[10,20].map((asDouble,index)=>({timeUnixNano:String(prior+BigInt(index)),asDouble,attributes:[{key:'host.name',value:{stringValue:index?'checkout-b':'checkout-a'}}]}))}}]}]}]})})
 assert.equal(intake.status,200);assert.equal((await fetch(origin+'/api/porthole/v1/ingest/drain',form(origin,cookie,{}))).status,200)
 const kinds=['query_value','timeseries','table','top_list','distribution','heatmap','pie','treemap','list','log_stream','notes']
 const panels=kinds.map(widget=>({...body.panels[widget==='log_stream'||widget==='notes'?1:0],id:widget,title:'Checkout '+widget.replaceAll('_',' '),widget,...(widget==='timeseries'?{compareWeek:true}:{}),...(widget==='notes'?{note:'Release inspected\n<script>window.untrustedNote=true</script>'}:{})}))
 const response=await fetch(origin+'/api/porthole/v1/dashboards',form(origin,cookie,{name:'Checkout widget comparison',scope,body:{...body,panels}}))
 assert.equal(response.status,201,await response.clone().text());const {id}=await response.json()
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();assert.equal((await page.goto(origin+'/app/dashboards/'+id)).status(),200)
  const panel=kind=>page.locator(`[data-panel="${kind}"]`)
  for(const kind of kinds)assert.equal(await panel(kind).count(),1)
  assert.match(await panel('query_value').innerText(),/30/)
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
  await page.getByLabel('team',{exact:true}).fill('payments');await page.getByLabel('environment',{exact:true}).fill('staging');await page.getByRole('button',{name:'Apply variables and range'}).click();assert.match(await page.getByRole('region',{name:'Previous UTC week'}).innerText(),/Previous value: No complete value/);assert.match(await page.getByRole('region',{name:'Previous UTC week'}).getByRole('status').innerText(),/empty/)
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`dashboard-week-empty-${width}.png`),fullPage:true})
  await context.close()
 }}finally{await browser.close()}
 console.log('Widget journey passed: actual scalar values, exact timestamp lines, raw tables, ranked series, bin counts, proportional totals, source log bodies and escaped notes at both widths')
}
