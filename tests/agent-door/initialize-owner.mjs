// Drives the same signed production claim and native first-run completion.
export default async function ({request,origin,claim,displayName,returnTo}) {
 const response=await request(origin+claim.path,{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:claim.token,displayName,returnTo})})
 if(response.status!==303)throw Error('Signed native owner claim failed')
 const cookie=response.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
 const setup=await request(origin+'/setup',{method:'POST',redirect:'manual',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({confirm:'yes'})})
 if(!setup.ok&&setup.status!==303)throw Error('Native setup completion failed')
 await setup.body?.cancel()
 return response
}
