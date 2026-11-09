// Fixture transport only: retain the stock two-second samples and timestamps,
// but pack them into fewer indivisible original-wire envelopes for erasure.
// Each pipeline needs its own processor instance: sharing one would combine
// producer and consumer subjects and correctly make local erasure refuse.
export function batchFixtureMetrics(config) {
 for(const [name,pipeline] of Object.entries(config.service.pipelines)) {
  const batch='batch/'+name.replaceAll('/','-')
  config.processors[batch]={timeout:'60s',send_batch_size:512,send_batch_max_size:512}
  pipeline.processors.push(batch)
 }
 return config
}
