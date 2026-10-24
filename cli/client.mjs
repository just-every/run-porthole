export function client({origin,credential,session,timeout=30000}) {
 let base
 try {base=new URL(origin)}catch {throw Error('Use the installation origin')}
 if(base.username || base.password || base.pathname!=='/' || base.search || base.hash || !(base.protocol==='https:' || base.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('Use an HTTPS installation origin; HTTP is allowed on loopback')
 if(credential!==undefined && !/^ph_[A-Za-z0-9_-]{43}$/.test(credential))throw Error('PORTHOLE_CREDENTIAL must contain a scoped credential')
 if(!credential && (!session || /[\r\n]/.test(session)))throw Error('Set PORTHOLE_CREDENTIAL or PORTHOLE_SESSION')
 return async function request(path,{method='GET',body,revision,key}={}) {
  if(!path.startsWith('/api/porthole/v1/'))throw Error('Unsupported API path')
  const headers={...(credential?{authorization:`Bearer ${credential}`}:{cookie:session}),origin:base.origin}
  if(body!==undefined)headers['content-type']='application/json'
  if(revision!==undefined)headers['if-match']=`"${revision}"`
  if(key)headers['idempotency-key']=key
  let response
  try {response=await fetch(new URL(path,base),{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(timeout)})}catch {throw Error('Porthole endpoint unavailable')}
  let value
  try {value=await response.json()}catch {throw Error('Porthole returned an unreadable response')}
  if(!response.ok) {
   const code=typeof value.error==='string' && /^[a-z_]+$/.test(value.error)?value.error:'request_refused'
   const retry=response.headers.get('retry-after'),hint=response.status===429&&/^\d+$/.test(retry??'')?`; retry after ${retry} seconds`:''
   throw Error(`Porthole refused (${response.status} ${code}${hint})`)
  }
  return value
 }
}

export function definitionRoot(collection) {
 if(!['monitors','repairs','dashboards'].includes(collection))throw Error('Use monitors, repairs or dashboards')
 return collection==='dashboards'?'/api/porthole/v1/dashboards':`/api/porthole/v1/configuration/${collection}`
}

export async function* definitionPages(request,{collection,limit=50,cursor,all=false}) {
 const root=definitionRoot(collection)
 const seen=new Set()
 do {
  const params=new URLSearchParams({limit:String(limit)})
  if(cursor)params.set('cursor',cursor)
  const page=await request(`${root}?${params}`)
  yield page
  cursor=page.cursor
  if(cursor && seen.has(cursor))throw Error('Porthole returned a repeated cursor')
  if(cursor)seen.add(cursor)
 }while(all&&cursor)
}

export async function* queryPages(request,{query,all=false}) {
 const seen=new Set();let body={...query}
 do {
  const page=await request('/api/porthole/v1/query',{method:'POST',body})
  yield page
  if(!all || !page.cursor)return
  if(seen.has(page.cursor))throw Error('Porthole returned a repeated cursor')
  seen.add(page.cursor);body={...body,cursor:page.cursor,snapshot:page.snapshot}
 }while(true)
}
