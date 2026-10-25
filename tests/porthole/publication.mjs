import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form} from './fixture.mjs'
const root='/app/dashboards/publications'
export async function publicationJourney({origin,cookie,freshOwner,dashboardId,restrictedCookie,signIn,sourceSecret}) {
 cookie=await freshOwner()
 const post=(path,data,session=cookie)=>fetch(origin+path,form(origin,session,data))
 const source=await (await fetch(origin+'/api/porthole/v1/dashboards/'+dashboardId,{headers:{cookie}})).json()
 const labels=Object.fromEntries(source.body.panels.slice(0,3).map((p,i)=>[p.id,['Office CPU','Office logs','Office latency'][i]]))
 const edge=createServer((request,response)=>{const parameters=new URL(request.url,'http://127.0.0.1').searchParams;response.setHeader('content-type','text/html');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="origin"></head><body><h1>Office display</h1>${parameters.has('image')?`<img alt="Published widget image" style="max-width:100%;height:auto" src="${origin}${parameters.get('image')}">`:`<iframe title="Published dashboard" width="100%" height="700" src="${origin}${parameters.get('frame')??'/missing'}"></iframe>`}</body></html>`)})
 await new Promise(resolve=>edge.listen(0,'127.0.0.1',resolve));const allowed='http://127.0.0.1:'+edge.address().port
 const input={dashboardId,sourceRevision:source.revision,publicTitle:'Office checkout health',labels,allowedOrigins:[allowed],expiresAt:Date.now()+3600000}
 const draft=async(data=input)=>{
  const response=await post(root+'/preview',data);assert.equal(response.status,303,await response.clone().text())
  const path=response.headers.get('location'),id=path.split('/').at(-1)
  return {id,path}
 }
 const packet=async item=>{
  const response=await fetch(origin+item.path,{headers:{cookie}});assert.equal(response.status,200);const html=await response.text()
  const values=Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(([,name,value])=>[name,value.replaceAll('&#34;','"').replaceAll('&#38;','&').replaceAll('&#39;',"'")]))
  return {values,html}
 }
 const consent={confirm:'reviewed-public-snapshot',reviewTv:'reviewed',reviewEmbed:'reviewed',reviewImages:'reviewed'}
 const readPublic=path=>fetch(origin+path,{headers:{origin:allowed}})
 const approve=async item=>{
  const {values}=await packet(item),response=await post(root+'/approve',{...values,...consent})
  assert.equal(response.status,303,await response.clone().text());return response
 }
 const addresses=async item=>{
  const {html}=await packet(item)
  return [...html.matchAll(/href="(\/published\/[^\"]+)"/g)].map(match=>match[1])
 }
 try {
  assert.equal((await post(root+'/preview',input,'')).status,401)
  assert.equal((await post(root+'/preview',input,restrictedCookie)).status,403)
  assert.equal((await post(root+'/preview',{...input,publicTitle:'https://private.example/auth?token=synthetic-porthole-220'})).status,400)
  assert.equal((await post(root+'/preview',{...input,allowedOrigins:['https://office.example/path']})).status,400)
  for(const expiresAt of [undefined,Date.now()-1])assert.equal((await post(root+'/preview',{...input,expiresAt})).status,400,'expiry is required and must be future')
  const first=await draft(),review=await packet(first)
  assert.ok(review.html.includes('Private source queries and filters'));assert.ok(review.html.includes('Office CPU'));assert.ok(review.html.includes('functions'));assert.ok(review.html.includes('rank'),'the exact transformation is part of the private consent packet')
  assert.equal((await fetch(origin+'/published/'+first.id+'/tv')).status,404,'draft never publishes')
  assert.equal((await post(root+'/approve',{...review.values,...consent,digest:'synthetic-porthole-221'})).status,409)
  assert.equal((await post(root+'/approve',{...review.values,...consent},restrictedCookie)).status,403)
  for(const field of ['confirm','reviewTv','reviewEmbed','reviewImages']) {
   const refused={...review.values,...consent};delete refused[field]
   assert.equal((await post(root+'/approve',refused)).status,409,'each surface requires explicit review')
  }
  for(const change of [{labels:{...labels,cpu:'New office label'}},{team:'payments',environment:'staging'},{expiresAt:input.expiresAt+60000},{allowedOrigins:[allowed,'https://second.example']}]) {
   const next=await draft({...input,...change}),nextReview=await packet(next)
   assert.notEqual(nextReview.values.digest,review.values.digest)
   assert.equal((await post(root+'/approve',{...nextReview.values,...consent,digest:review.values.digest})).status,409,'review N cannot approve changed projection N+1')
   assert.equal((await fetch(origin+'/published/'+next.id+'/tv')).status,404)
  }
  await approve(first)
  let urls=await addresses(first);assert.equal(urls.length,5)
  for(const path of urls) {
   const response=await readPublic(path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
   const text=await response.text()
   for(const privateText of ['Checkout CPU','Checkout log count','Checkout latency p95','Payment dependency rollout','/app/explore','commerce','production',cookie,sourceSecret])assert.ok(!text.includes(privateText),'public projection excludes private source fields')
  }
  const embed=origin+'/published/'+first.id+'/embed'
  for(const headers of [{},{origin:'https://denied.example'},{referer:'https://denied.example/'},{origin:allowed,referer:'https://denied.example/'},{origin:'null'}])assert.equal((await fetch(embed,{headers})).status,403)
  const baseline=await Promise.all(urls.map(async path=>[path,await (await readPublic(path)).text()]))
  const beforeProjection=JSON.parse(review.html.match(/<pre>(.*?)<\/pre>/s)[1].replaceAll('&#34;','"').replaceAll('&#38;','&').replaceAll('&#39;',"'"))
  for(const [path,text]of baseline) {
   if(path.endsWith('.svg')) {
    const panel=beforeProjection.panels.find(p=>path.endsWith('/'+p.id+'.svg'))
    assert.ok(text.includes(`>${panel.label}</text>`));assert.ok(text.includes(`>${panel.value===null?'No complete value':panel.value} ${panel.unit}</text>`))
   }else {
    assert.deepEqual([...text.matchAll(/<h2>(.*?)<\/h2>/g)].map(m=>m[1]),beforeProjection.panels.map(p=>p.label))
    assert.deepEqual([...text.matchAll(/<strong>(.*?)<\/strong>/g)].map(m=>m[1]),beforeProjection.panels.map(p=>p.value===null?'No complete value':String(p.value)))
   }
  }
  const point={resource:{attributes:[{key:'service.name',value:{stringValue:'checkout'}},{key:'deployment.environment.name',value:{stringValue:'production'}},{key:'team.name',value:{stringValue:'commerce'}}]},scopeMetrics:[{metrics:[{name:'checkout.cpu',unit:'%',gauge:{dataPoints:[{timeUnixNano:String(BigInt(source.body.range.from)+100n),asDouble:900,attributes:[{key:'host.name',value:{stringValue:'checkout-c'}}]}]}}]}]}
  const intake=form(origin,'',{resourceMetrics:[point]});intake.headers.authorization='Bearer '+sourceSecret
  assert.equal((await fetch(origin+'/v1/metrics',intake)).status,200)
  assert.equal((await post('/api/porthole/v1/ingest/drain',{})).status,200)
  const changed=await packet(await draft()),changedProjection=JSON.parse(changed.html.match(/<pre>(.*?)<\/pre>/s)[1].replaceAll('&#34;','"').replaceAll('&#38;','&').replaceAll('&#39;',"'"))
  assert.notEqual(changedProjection.panels.find(p=>p.label==='Office CPU').value,beforeProjection.panels.find(p=>p.label==='Office CPU').value,'private data changed through real intake')
  for(const [path,text]of baseline)assert.equal(await (await readPublic(path)).text(),text,'every address retains exactly the reviewed numeric projection')
  const clone=await post('/app/dashboards/clone',{id:source.id,revision:source.revision});assert.equal(clone.status,303)
  const cloneId=clone.headers.get('location').split('/').at(-1)
  const clonePage=await (await fetch(origin+'/app/dashboards/'+cloneId+'/publish',{headers:{cookie}})).text();assert.ok(clonePage.includes('No publication snapshots.'))

  await publicationBrowser({origin,cookie,dashboardId,allowed,labels,source,first,urls})
  // Every URL dies together; a screenshot or downloaded file already held by a
  // recipient cannot be recalled, so HTTP responses are never cacheable.
  assert.equal((await post(root+'/revoke',{id:first.id})).status,303)
  for(const path of urls)assert.equal((await readPublic(path)).status,404)
  const expired=await draft({...input,expiresAt:Date.now()+5000});await approve(expired);const expiredUrls=await addresses(expired)
  for(const path of expiredUrls)assert.equal((await readPublic(path)).status,200,'unexpired surface remains available')
  await new Promise(resolve=>setTimeout(resolve,5100))
  for(const path of expiredUrls)assert.equal((await readPublic(path)).status,404,'expiry fences every surface at its deadline')
  const authorityItem=await draft();await approve(authorityItem);const authorityUrls=await addresses(authorityItem)
  const session=await (await fetch(origin+'/auth/session',{headers:{cookie}})).json()
  const analystSession=await (await fetch(origin+'/auth/session',{headers:{cookie:restrictedCookie}})).json()
  const analystId=analystSession.operator.id,ownerId=session.operator.id
  assert.equal((await post('/app/settings/members/change',{operatorId:analystId,role:'owner',confirmEmail:'synthetic-porthole-181@example.com'})).status,200)
  const secondOwner=await signIn('synthetic-porthole-181@example.com')
  assert.equal((await post('/app/settings/members/change',{operatorId:ownerId,role:'admin'},secondOwner)).status,200)
  for(const path of authorityUrls)assert.equal((await readPublic(path)).status,404,'authority loss fences every surface on next read')
  assert.equal((await post('/app/settings/members/change',{operatorId:ownerId,role:'owner',confirmEmail:session.operator.email},secondOwner)).status,200)
  for(const path of authorityUrls)assert.equal((await readPublic(path)).status,404,'restoring authority never revives old publications')
  cookie=await freshOwner()
  const renewed=await draft();await approve(renewed);assert.equal((await readPublic('/published/'+renewed.id+'/tv')).status,200,'fresh owner review renews with a new address')
  const stale=await draft();await approve(stale);const staleUrls=await addresses(stale)
  const unreviewed=await draft(),unreviewedPacket=await packet(unreviewed)

  assert.equal((await post('/api/porthole/v1/dashboards',{id:source.id,revision:source.revision,name:source.name,scope:source.scope,body:source.body})).status,201)
  for(const path of staleUrls)assert.equal((await readPublic(path)).status,404,'native edit invalidates every address')
  assert.equal((await post(root+'/approve',{...unreviewedPacket.values,...consent})).status,409,'stale source review is refused')
  assert.equal((await post(root+'/preview',input)).status,409,'stale source projection is refused')
  for(const edit of ['query','function']) {
   const current=await (await fetch(origin+'/api/porthole/v1/dashboards/'+dashboardId,{headers:{cookie}})).json()
   const currentInput={...input,sourceRevision:current.revision},previous=await draft(currentInput),previousReview=await packet(previous)
   const body=structuredClone(current.body)
   if(edit==='query')body.panels.find(p=>p.id==='cpu').metric='unrelated'
   else body.panels.find(p=>p.id==='cpu').functions=[{kind:'rank',limit:1}]
   assert.equal((await post('/api/porthole/v1/dashboards',{id:current.id,revision:current.revision,name:current.name,scope:current.scope,body})).status,201)
   assert.equal((await post(root+'/approve',{...previousReview.values,...consent})).status,409,edit+' changes require fresh review')
   const next=await draft({...currentInput,sourceRevision:current.revision+1}),nextReview=await packet(next)
   assert.equal((await post(root+'/approve',{...nextReview.values,...consent,digest:previousReview.values.digest})).status,409)
  }

  const latest=await (await fetch(origin+'/api/porthole/v1/dashboards/'+dashboardId,{headers:{cookie}})).json()
  const active=await draft({...input,sourceRevision:latest.revision});await approve(active);const activePaths=await addresses(active)
  for(const path of activePaths)assert.equal((await readPublic(path)).status,200)
  const audit=await (await fetch(origin+'/api/v1/audit/export',{headers:{cookie}})).json()
  for(const action of ['dashboards.publication-preview','dashboards.publication-approve','dashboards.publication-revoke'])assert.ok(JSON.stringify(audit).includes(action));
  assert.ok(JSON.stringify(audit).includes(first.id));assert.ok(!JSON.stringify(audit).includes('Office checkout health'))
  console.log('Public snapshot journey passed: exact native-owner consent, safe projection, live-source revision, anonymous TV, allowed-origin frame, SVG images, expiry and all-address revocation')
  return activePaths
 }finally{await new Promise(resolve=>edge.close(resolve))}
}
async function publicationBrowser({origin,cookie,dashboardId,allowed,labels,source,first,urls}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 if(process.env.PORTHOLE_EVIDENCE_DIR)await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true})
 try {for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();await page.goto(origin+'/app/dashboards/'+dashboardId+'/publish')
  await page.getByLabel('Public title',{exact:true}).fill('Office release '+width)
  await page.getByLabel('Public labels as a JSON object mapping selected private panel identifiers to manually chosen public labels',{exact:true}).fill(JSON.stringify(labels))
  const expiry=new Date(Date.now()+3600000).toISOString()
  await page.getByLabel('Expiry in UTC',{exact:true}).fill(expiry)
  await page.getByLabel('Allowed embed origins as a JSON array',{exact:true}).fill(JSON.stringify([allowed]))
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`publication-form-${width}.png`),fullPage:true})
  await page.getByRole('button',{name:'Read source and preview exact publication'}).click();await page.getByRole('heading',{name:'Review public snapshot',exact:true}).waitFor()
  const packet=await page.locator('pre').allTextContents()
  const projection=JSON.parse(packet[0]),review=JSON.parse(packet[1])
  assert.equal(projection.title,'Office release '+width);assert.deepEqual(projection.panels.map(p=>p.label).sort(),Object.values(labels).sort())
  assert.equal(review.panels.length,3);assert.ok(review.panels.every(p=>p.query.startsWith('/app/explore?')&&Array.isArray(p.functions)))
  assert.deepEqual(review.panels.find(p=>p.sourcePanel==='cpu').functions,[{kind:'rank',limit:2}])
  assert.equal(review.filters.team,'commerce');assert.equal(review.filters.environment,'production');assert.deepEqual(projection.range,source.body.range)
  assert.equal(await page.locator('input[name=expiresAt]').inputValue(),String(Date.parse(expiry)));assert.ok((await page.locator('main').innerText()).includes('Expiry: '+expiry))
  for(const panel of review.panels) {const query=new URL(panel.query,origin);assert.equal(query.searchParams.get('service'),'checkout');assert.equal(query.searchParams.get('team'),review.filters.team);assert.equal(query.searchParams.get('environment'),review.filters.environment);assert.equal(query.searchParams.get('from'),projection.range.from);assert.equal(query.searchParams.get('through'),projection.range.through)}
  assert.deepEqual(projection.panels.map(p=>p.value),[470,2,400])
  assert.deepEqual(JSON.parse(packet[2]),[allowed]);assert.ok((await page.getByRole('heading',{name:'Audience and expiry',exact:true}).count())===1)
  for(const checkbox of await page.getByRole('checkbox').all())await checkbox.check()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'review fits viewport')
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`publication-review-${width}.png`),fullPage:true})
  await page.getByRole('button',{name:'Approve this exact snapshot'}).click();await page.getByRole('link',{name:'Public TV',exact:true}).waitFor()
  const publicPath=await page.getByRole('link',{name:'Public TV',exact:true}).getAttribute('href')
  const anonymous=await browser.newContext({viewport:{width,height:width===1440?900:844}}),visitor=await anonymous.newPage()
  await visitor.goto(origin+publicPath);await visitor.getByRole('heading',{name:'Office release '+width,exact:true}).waitFor()
  const articles=visitor.getByRole('region',{name:'Published values'}).getByRole('article')
  for(const [index,panel]of projection.panels.entries()) {assert.equal(await articles.nth(index).getByRole('heading').innerText(),panel.label);assert.equal(await articles.nth(index).locator('strong').innerText(),panel.value===null?'No complete value':String(panel.value))}
  assert.ok(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(process.env.PORTHOLE_EVIDENCE_DIR)await visitor.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`publication-tv-${width}.png`),fullPage:true})
  await visitor.goto(allowed+'/?frame='+encodeURIComponent('/published/'+first.id+'/embed'))
  await visitor.frameLocator('iframe').getByRole('heading',{name:'Office checkout health',exact:true}).waitFor()
  if(process.env.PORTHOLE_EVIDENCE_DIR)await visitor.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`publication-embed-${width}.png`),fullPage:true})
  const image=urls.find(path=>path.endsWith('.svg'));await visitor.goto(allowed+'/?image='+encodeURIComponent(image));assert.ok(await visitor.getByRole('img',{name:'Published widget image'}).evaluate(image=>image.complete&&image.naturalWidth>0))
  if(process.env.PORTHOLE_EVIDENCE_DIR)await visitor.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`publication-image-${width}.png`),fullPage:true})
  await page.getByRole('button',{name:'Revoke every public address now'}).click();assert.equal((await visitor.goto(origin+publicPath)).status(),404)
  if(process.env.PORTHOLE_EVIDENCE_DIR)await visitor.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`publication-revoked-${width}.png`),fullPage:true})
  await anonymous.close();await context.close()
 }}finally{await browser.close()}
}
