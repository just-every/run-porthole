// A service binding crosses a real local HTTP boundary in the analytical
// estate. Forward end-to-end headers, then let the HTTP client frame its own
// buffered body. Incoming chunk framing belongs to the preceding connection.
export async function analyticalTransport(origin, request) {
 const headers=new Headers(request.headers)
 const connection=(headers.get('connection')??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean)
 for(const name of [...connection,'connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','content-length'])headers.delete(name)
 return fetch(origin+new URL(request.url).pathname,{
  method:request.method,headers,
  ...(request.method==='POST'?{body:Buffer.from(await request.arrayBuffer())}:{}),
  redirect:'manual',signal:request.signal,
 })
}
