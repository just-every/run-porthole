export const nativeCatalog={
 version:1,
 qualification:'Native bounded processors. Complete source-exact Datadog import and corpus comparison remain unqualified.',
 order:'Processors run in array order. A failure adds a diagnostic code; later processors still run. Existing attributes require an explicit overwrite where offered.',
 output:'Extracted attributes live in payload.pipeline.attributes. Service, environment, team and structural trace identity cannot be rerouted by a processor.',
 processors:[
  {type:'json',name:'JSON parser',example:{type:'json'},behavior:'Parses one JSON object, including multiline bodies. Malformed input remains a protected sanitized record.'},
  {type:'kv',name:'Key-value parser',example:{type:'kv'},behavior:'Whitespace-separated keys with quoted or unquoted values. Duplicate keys and malformed quoting diagnose a failure.'},
  {type:'grok',name:'Named grok captures',example:{type:'grok',pattern:'%{word:level} %{greedyData:message}'},behavior:'Whole-input literal matching with word, integer, number, notSpace, data and final greedyData captures. Arbitrary regular expressions and Datadog filters are not qualified.'},
  {type:'enrich',name:'Attribute enrichment',example:{type:'enrich',values:{region:'us-east'}},behavior:'Adds scalar attributes. Existing fields require overwrite=true.'},
  {type:'remap',name:'Attribute remapper',example:{type:'remap',from:'message',to:'message.original',removeSource:true},behavior:'Copies a typed value; optional explicit source removal and target overwrite.'},
  {type:'status',name:'Status remapper',example:{type:'status',source:'level'},behavior:'Maps known native status strings or an explicit mapping. Unknown values diagnose a failure.'},
  {type:'category',name:'Category by match',example:{type:'category',target:'category',categories:[{name:'checkout-error',field:'status',equals:'error'}]},behavior:'First exact scalar match wins. Full source search-language equivalence is unqualified.'},
  {type:'lookup',name:'Versioned lookup table',example:{type:'lookup',source:'region',target:'region.name',version:'revision-1',table:{us:'United States'}},behavior:'Looks up exact scalar keys. A miss uses the explicit default or diagnoses a lookup miss.'},
  {type:'url',name:'URL parser',example:{type:'url',source:'url',target:'url.details'},behavior:'Parses HTTP or HTTPS URLs into scheme, host, port, path, query and fragment attributes.'},
  {type:'user-agent',name:'User-agent parser',example:{type:'user-agent',source:'agent',target:'agent.details'},behavior:'Extracts a bounded browser, version, operating system and device classification. Full vendor parsing parity is unqualified.'},
  {type:'arithmetic',name:'Arithmetic expression',example:{type:'arithmetic',target:'total',left:'quantity',operator:'*',right:'price'},behavior:'One typed numeric operation. Missing values, wrong types, overflow and division by zero diagnose a failure.'},
  {type:'route',name:'Logical routing',example:{type:'route',field:'status',equals:'error',destination:'error-stream'},behavior:'Records a logical destination attribute. It does not grant authority or contact another destination.'}
 ]
}
