import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {form} from './fixture.mjs'
const root='/app/dashboards/publications'
export async function publicationJourney({origin,cookie,freshOwner,dashboardId,restrictedCookie,sql}) {
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
 const approve=async item=>{
  const {values}=await packet(item),response=await post(root+'/approve',{...values,confirm:'reviewed-public-snapshot'})
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
  const first=await draft(),review=await packet(first)
  assert.ok(review.html.includes('Private source queries and filters'));assert.ok(review.html.includes('Office CPU'));assert.ok(review.html.includes('functions'));assert.ok(review.html.includes('rank'),'the exact transformation is part of the private consent packet')
  assert.equal((await fetch(origin+'/published/'+first.id+'/tv')).status,404,'draft never publishes')
  assert.equal((await post(root+'/approve',{...review.values,digest:'synthetic-porthole-221',confirm:'reviewed-public-snapshot'})).status,409)
  await approve(first)
  let urls=await addresses(first);assert.equal(urls.length,5)
  for(const path of urls) {
   const response=await fetch(origin+path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
   const text=await response.text()
   for(const privateText of ['Checkout CPU','Checkout log count','Checkout latency p95','Payment dependency rollout','/app/explore','commerce','production',cookie])assert.ok(!text.includes(privateText),'public projection excludes private source fields')
  }
  assert.equal((await fetch(origin+'/published/'+first.id+'/embed',{headers:{origin:'https://denied.example',referer:'https://denied.example/'}})).status,403)
  await publicationBrowser({origin,cookie,dashboardId,allowed,labels,source,first,urls})
  // Every URL dies together; a screenshot or downloaded file already held by a
  // recipient cannot be recalled, so HTTP responses are never cacheable.
  assert.equal((await post(root+'/revoke',{id:first.id})).status,303)
  for(const path of urls)assert.equal((await fetch(origin+path)).status,404)
  const expired=await draft({...input,expiresAt:Date.now()+5000});await approve(expired)
  await new Promise(resolve=>setTimeout(resolve,5100))
  assert.equal((await fetch(origin+'/published/'+expired.id+'/tv')).status,404)
  const stale=await draft();await approve(stale)
  assert.equal((await post('/api/porthole/v1/dashboards',{id:source.id,revision:source.revision,name:source.name,scope:source.scope,body:source.body})).status,201)
  assert.equal((await fetch(origin+'/published/'+stale.id+'/tv')).status,404,'native edit invalidates its publication')
  const audit=await (await fetch(origin+'/api/v1/audit/export',{headers:{cookie}})).json()
  assert.ok(JSON.stringify(audit).includes(first.id));assert.ok(!JSON.stringify(audit).includes('Office checkout health'))
  console.log('Public snapshot journey passed: exact native-owner consent, safe projection, live-source revision, anonymous TV, allowed-origin frame, SVG images, expiry and all-address revocation')
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
  await page.getByLabel('Expiry in UTC',{exact:true}).fill(new Date(Date.now()+3600000).toISOString())
  await page.getByLabel('Allowed embed origins as a JSON array',{exact:true}).fill(JSON.stringify([allowed]))
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`publication-form-${width}.png`),fullPage:true})
  await page.getByRole('button',{name:'Read source and preview exact publication'}).click();await page.getByRole('heading',{name:'Review public snapshot',exact:true}).waitFor()
  await page.getByRole('checkbox').check()
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`publication-review-${width}.png`),fullPage:true})
  await page.getByRole('button',{name:'Approve this exact snapshot'}).click();await page.getByRole('link',{name:'Public TV',exact:true}).waitFor()
  const publicPath=await page.getByRole('link',{name:'Public TV',exact:true}).getAttribute('href')
  const anonymous=await browser.newContext({viewport:{width,height:width===1440?900:844}}),visitor=await anonymous.newPage()
  await visitor.goto(origin+publicPath);await visitor.getByRole('heading',{name:'Office release '+width,exact:true}).waitFor()
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
