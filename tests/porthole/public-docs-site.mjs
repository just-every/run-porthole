import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,readdir,mkdir} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {servedFile} from '@runeditrun/rer/internal/cli/site-check.mjs'

/** Serve the real built assets using the static host's path resolution. */
export async function publicSite() {
 const root=resolve('dist/site'),entries=await readdir(root,{recursive:true,withFileTypes:true})
 const files=new Set(entries.filter(entry=>entry.isFile()).map(entry=>join(relative(root,entry.parentPath),entry.name)))
 const types={'.html':'text/html','.json':'application/json','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'}
 const server=createServer(async(request,response)=>{
  try {
   const path=new URL(request.url,'http://localhost').pathname,file=servedFile(files,path)
   if(!file){response.writeHead(404);response.end();return}
   response.setHeader('Content-Type',Object.entries(types).find(([ext])=>file.endsWith(ext))?.[1]??'application/octet-stream')
   response.end(await readFile(join(root,file)))
  } catch {response.writeHead(500);response.end()}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 return {origin:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))}
}

export async function browsePublicDocs(site,privateValues) {
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const snippets={}
 try {
  const desktop=await browser.newContext({viewport:{width:1440,height:900}}),page=await desktop.newPage()
  await page.goto(site+'/docs/v1')
  const paths=await page.locator('.docs-card').evaluateAll(links=>links.map(link=>new URL(link.href).pathname))
  assert.ok(paths.length>0,'public version index offers product guides')
  for(const path of ['/docs','/docs/v1',...paths]) {
   const response=await page.goto(site+path)
   assert.equal(response.status(),200,path)
   await page.getByRole('heading',{level:1}).waitFor()
   // Every same-site documentation, schema and example link is a working public door.
   const links=await page.locator('a[href]').evaluateAll(links=>links.map(link=>link.getAttribute('href')).filter(href=>href.startsWith('/docs')||href.startsWith('/openapi/')))
   for(const href of new Set(links)) {
    const target=await fetch(site+href)
    assert.equal(target.status,200,`${path} links to ${href}`)
    const hash=new URL(href,site).hash
    if(hash){const html=await target.text();assert.ok(html.includes(`id="${decodeURIComponent(hash.slice(1))}"`),`${path} anchor ${href}`)}
   }
   const text=await response.text()
   for(const value of privateValues)assert.ok(!text.includes(value),'published documentation excludes installation data')
   snippets[path]=await page.locator('[data-copy]').evaluateAll(buttons=>buttons.map(button=>button.dataset.copy))
   await readable(page,path)
   await capture(page,path,1440)
  }
  await desktop.close()
  // The clause's one phone smoke walks the same guides and the collapsed navigation.
  const phone=await browser.newContext({viewport:{width:390,height:844}}),mobile=await phone.newPage()
  for(const path of ['/docs','/docs/v1',...paths]) {
   assert.equal((await mobile.goto(site+path)).status(),200)
   await mobile.getByRole('heading',{level:1}).waitFor()
   await readable(mobile,path)
   const menu=mobile.locator('.docs-menu')
   if(await menu.count()) {
    await menu.locator('summary').click()
    const current=menu.locator('[aria-current="page"]')
    await current.scrollIntoViewIfNeeded()
    assert.equal(await current.getAttribute('href'),path)
    await menu.locator('summary').click()
   }
   await capture(mobile,path,390)
  }
  await phone.close()
 } finally {await browser.close()}
 return snippets
}

async function readable(page,path) {
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${path} fits viewport`)
 const failures=await page.evaluate(()=>{
  const shown=node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'
  return [...document.querySelectorAll('.docs-layout *, .docs-index *')].filter(node=>shown(node)&&[...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim())&&parseFloat(getComputedStyle(node).fontSize)<13).map(node=>node.className)
 })
 assert.deepEqual(failures,[],`${path} readable text`)
 await page.keyboard.press('Tab')
 assert.notEqual(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'none')
}
async function capture(page,path,width) {
 if(!process.env.PORTHOLE_EVIDENCE_DIR)return
 await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true})
 await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`public${path.replaceAll('/','-')}-${width}.png`),fullPage:true})
}
