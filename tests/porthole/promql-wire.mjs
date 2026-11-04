// Schema-edge samples use Prometheus remote-write 1.0 WriteRequest,
// TimeSeries, Sample and MetricMetadata from the pinned 3.5.0 release.
const varint=value=>{let n=BigInt(value),bytes=[];while(n>127n){bytes.push(Number(n&127n)|128);n>>=7n}bytes.push(Number(n));return Buffer.from(bytes)}
const field=(number,wire,value)=>Buffer.concat([varint((number<<3)|wire),value])
const message=(number,body)=>field(number,2,Buffer.concat([varint(body.length),body]))
const string=(number,value)=>message(number,Buffer.from(value))
const uint=(number,value)=>field(number,0,varint(value))
const double=value=>{const bytes=Buffer.alloc(8);if(value==='stale')bytes.writeBigUInt64LE(0x7ff0000000000002n);else bytes.writeDoubleLE(value);return field(1,1,bytes)}
export function referenceWire(t) {
 const scope={service:'checkout-promql',environment:'promql',team:'commerce'}
 const series=[
  {name:'synthetic_porthole_boundary',lane:'edge',kind:2,samples:[[t,3],[t+10000,4]]},
  {name:'synthetic_porthole_stale',lane:'stale',kind:2,samples:[[t,7],[t+10000,8],[t+15000,'stale']]},
  {name:'synthetic_porthole_edge_counter',lane:'reset',kind:1,samples:[[t,5],[t+10000,15],[t+20000,3],[t+30000,13]]},
  {name:'synthetic_porthole_nan',lane:'nan',kind:2,samples:[[t,NaN]]},
 ]
 const body=Buffer.concat(series.flatMap(row=>{
  const labels={__name__:row.name,...scope,lane:row.lane}
  const samples=Buffer.concat(row.samples.map(([time,value])=>message(2,Buffer.concat([double(value),uint(2,time)]))))
  return [message(1,Buffer.concat([...Object.entries(labels).map(([name,value])=>message(1,Buffer.concat([string(1,name),string(2,value)]))),samples])),message(3,Buffer.concat([uint(1,row.kind),string(2,row.name),string(5,'items')]))]
 }))
 const length=body.length-1,bytes=[];let n=length;while(n){bytes.push(n&255);n>>>=8}
 return Buffer.concat([varint(body.length),Buffer.from(length<60?[length<<2]:[(59+bytes.length)<<2,...bytes]),body])
}
export async function wireCases(reference) {
 if(reference.edges)return reference.edges
 const wire=referenceWire(reference.t),response=await fetch(reference.origin+'/api/v1/write',{method:'POST',headers:{'content-type':'application/x-protobuf','content-encoding':'snappy','x-prometheus-remote-write-version':'0.1.0'},body:wire})
 if(!response.ok)throw Error('Stock reference refused schema samples: '+response.status+' '+await response.text())
 const ns=ms=>String(BigInt(ms)*1000000n),at=reference.t
 const cases=[
  {expression:'synthetic_porthole_boundary',settings:{time:ns(at+20000),lookback:10}},
  {expression:'synthetic_porthole_boundary',settings:{time:ns(at+19999),lookback:10}},
  {expression:'synthetic_porthole_stale',settings:{start:ns(at+10000),end:ns(at+25000),step:5}},
  {expression:'rate(synthetic_porthole_edge_counter[30s])',settings:{time:ns(at+30000)}},
  {expression:'increase(synthetic_porthole_edge_counter[30s])',settings:{time:ns(at+30000)}},
  {expression:'rate(synthetic_porthole_edge_counter[10s])',settings:{time:ns(at+30000)}},
 ]
 for(const item of cases)item.expected=await reference.query(item.expression,item.settings)
 return reference.edges={wire,cases}
}
