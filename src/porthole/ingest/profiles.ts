// opentelemetry-proto v1.9.0 profiles/v1development. Dictionary references are
// local to an ExportRequest, so each stored profile carries its original table.
import { array, invalid, nano, object } from './model'
type Dictionary = Record<string, unknown[]>
const tables = ['mappingTable','locationTable','functionTable','linkTable','stringTable','attributeTable','stackTable']
const repeated = (value: unknown) => value === undefined ? [] : array(value)
const zero = (value: unknown): boolean => value === 0 || value === false || typeof value === 'string' && /^0*$/.test(value) || Array.isArray(value) && !value.length || !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(zero)
function index(value: unknown, table: unknown[]): number {
 const n=value ?? 0
 if(typeof n!=='number'||!Number.isInteger(n)||n<0||n>2147483647||n>=table.length)invalid('invalid_profile_dictionary_index')
 return n as number
}
function signed(value:unknown) {
 if(typeof value!=='string'||! /^-?(0|[1-9][0-9]*)$/.test(value)||BigInt(value)<-9223372036854775808n||BigInt(value)>9223372036854775807n)invalid('invalid_profile_int64')
}
function attributes(value: unknown, dictionary: Dictionary) {
 const keys=new Set<unknown>()
 for(const ref of repeated(value)) {
  const attr=object(dictionary.attributeTable[index(ref,dictionary.attributeTable)]),key=dictionary.stringTable[index(attr.keyStrindex,dictionary.stringTable)]
  if(keys.has(key))invalid('duplicate_profile_attribute')
  keys.add(key)
 }
}
export function profileDictionary(value: unknown): Dictionary {
 const raw=object(value),dictionary:Dictionary={}
 for(const key of tables) {
  const entries=array(raw[key])
  if(!entries.length||(key==='stringTable'?entries[0]!==''||entries.some(entry=>typeof entry!=='string'):!zero(entries[0])))invalid('invalid_profile_dictionary')
  dictionary[key]=entries
 }
 for(const raw of dictionary.attributeTable) {
  const entry=object(raw);index(entry.keyStrindex,dictionary.stringTable);index(entry.unitStrindex,dictionary.stringTable)
  if(entry.value!==undefined)object(entry.value)
 }
 for(const raw of dictionary.mappingTable) {
  const entry=object(raw);index(entry.filenameStrindex,dictionary.stringTable);attributes(entry.attributeIndices,dictionary)
  for(const key of ['memoryStart','memoryLimit','fileOffset'])if(entry[key]!==undefined)nano(entry[key])
 }
 for(const raw of dictionary.functionTable) {
  const entry=object(raw)
  for(const key of ['nameStrindex','systemNameStrindex','filenameStrindex'])index(entry[key],dictionary.stringTable)
  if(entry.startLine!==undefined)signed(entry.startLine)
 }
 for(const raw of dictionary.locationTable) {
  const entry=object(raw);index(entry.mappingIndex,dictionary.mappingTable);attributes(entry.attributeIndices,dictionary)
  if(entry.address!==undefined)nano(entry.address)
  for(const line of repeated(entry.lines)) {
   const entry=object(line);index(entry.functionIndex,dictionary.functionTable)
   for(const key of ['line','column'])if(entry[key]!==undefined)signed(entry[key])
  }
 }
 for(const raw of dictionary.stackTable)for(const ref of repeated(object(raw).locationIndices))index(ref,dictionary.locationTable)
 for(const raw of dictionary.linkTable.slice(1)) {
  const entry=object(raw)
  if(typeof entry.traceId!=='string'||!/^[a-fA-F0-9]{32}$/.test(entry.traceId)||/^0+$/.test(entry.traceId)||typeof entry.spanId!=='string'||!/^[a-fA-F0-9]{16}$/.test(entry.spanId)||/^0+$/.test(entry.spanId))invalid('invalid_profile_trace_link')
 }
 return dictionary
}
export function validateProfile(entry: Record<string,unknown>, dictionary: Dictionary) {
 for(const key of ['sampleType','periodType'])if(entry[key]!==undefined) {
  const value=object(entry[key]);index(value.typeStrindex,dictionary.stringTable);index(value.unitStrindex,dictionary.stringTable)
 }
 const start=BigInt(nano(entry.timeUnixNano??'0')),duration=BigInt(nano(entry.durationNano??'0'))
 if(start+duration>18446744073709551615n)invalid('invalid_profile_duration')
 if(entry.period!==undefined)signed(entry.period)
 if(entry.profileId!==undefined&&(typeof entry.profileId!=='string'||!/^[a-fA-F0-9]{32}$/.test(entry.profileId)||/^0+$/.test(entry.profileId)))invalid('invalid_profile_id')
 if(!!entry.originalPayloadFormat!==!!entry.originalPayload)invalid('invalid_profile_original_payload')
 if(entry.originalPayload!==undefined) {
  if(typeof entry.originalPayloadFormat!=='string'||typeof entry.originalPayload!=='string')invalid('invalid_profile_original_payload')
  try{atob(entry.originalPayload as string)}catch{invalid('invalid_profile_original_payload')}
 }
 attributes(entry.attributeIndices,dictionary)
 for(const raw of repeated(entry.samples)) {
  const sample=object(raw),values=repeated(sample.values),times=repeated(sample.timestampsUnixNano)
  if(!values.length&&!times.length||values.length&&times.length&&values.length!==times.length)invalid('invalid_profile_sample')
  values.forEach(signed)
  for(const value of times) {
   const time=BigInt(nano(value))
   if(time<start||time>start+duration)invalid('profile_sample_outside_time_range')
  }
  index(sample.stackIndex,dictionary.stackTable);index(sample.linkIndex,dictionary.linkTable);attributes(sample.attributeIndices,dictionary)
 }
}

/** An export-wide dictionary can contain other teams' strings and trace IDs.
 * Keep only this profile's transitive references and rebase their indices.
 * The durable, owner-only envelope still retains every original wire byte. */
export function isolateProfile(profile: Record<string,unknown>, source: Dictionary) {
 const used=Object.fromEntries(tables.map(key=>[key,new Set<number>([0])])) as Record<string,Set<number>>
 const keep=(table:string,value:unknown)=>{const n=index(value,source[table]);used[table].add(n);return n}
 const attrs=(value:unknown)=>{for(const ref of repeated(value))keep('attributeTable',ref)}
 const record=structuredClone(profile)
 for(const key of ['sampleType','periodType'])if(record[key]!==undefined) {
  const type=object(record[key]);keep('stringTable',type.typeStrindex);keep('stringTable',type.unitStrindex)
 }
 attrs(record.attributeIndices)
 for(const raw of repeated(record.samples)) {
  const sample=object(raw);keep('stackTable',sample.stackIndex);keep('linkTable',sample.linkIndex);attrs(sample.attributeIndices)
 }
 for(const n of used.stackTable)for(const ref of repeated(object(source.stackTable[n]).locationIndices))keep('locationTable',ref)
 for(const n of used.locationTable) {
  const location=object(source.locationTable[n]);keep('mappingTable',location.mappingIndex);attrs(location.attributeIndices)
  for(const line of repeated(location.lines))keep('functionTable',object(line).functionIndex)
 }
 for(const n of used.mappingTable){const mapping=object(source.mappingTable[n]);keep('stringTable',mapping.filenameStrindex);attrs(mapping.attributeIndices)}
 for(const n of used.functionTable)for(const key of ['nameStrindex','systemNameStrindex','filenameStrindex'])keep('stringTable',object(source.functionTable[n])[key])
 for(const n of used.attributeTable){const attr=object(source.attributeTable[n]);keep('stringTable',attr.keyStrindex);keep('stringTable',attr.unitStrindex)}
 const maps=Object.fromEntries(tables.map(key=>[key,new Map([...used[key]].sort((a,b)=>a-b).map((old,next)=>[old,next]))]))
 const dictionary=Object.fromEntries(tables.map(key=>[key,[...maps[key].keys()].map(n=>structuredClone(source[key][n]))])) as Dictionary
 const ref=(entry:Record<string,unknown>,key:string,table:string)=>{if(entry[key]!==undefined)entry[key]=maps[table].get(entry[key] as number)}
 const refs=(entry:Record<string,unknown>,key:string,table:string)=>{if(entry[key]!==undefined)entry[key]=repeated(entry[key]).map(value=>maps[table].get(value as number))}
 for(const key of ['sampleType','periodType'])if(record[key]!==undefined){const entry=object(record[key]);ref(entry,'typeStrindex','stringTable');ref(entry,'unitStrindex','stringTable')}
 refs(record,'attributeIndices','attributeTable')
 for(const raw of repeated(record.samples)){const sample=object(raw);ref(sample,'stackIndex','stackTable');ref(sample,'linkIndex','linkTable');refs(sample,'attributeIndices','attributeTable')}
 for(const raw of dictionary.stackTable)refs(object(raw),'locationIndices','locationTable')
 for(const raw of dictionary.locationTable){const entry=object(raw);ref(entry,'mappingIndex','mappingTable');refs(entry,'attributeIndices','attributeTable');for(const line of repeated(entry.lines))ref(object(line),'functionIndex','functionTable')}
 for(const raw of dictionary.mappingTable){const entry=object(raw);ref(entry,'filenameStrindex','stringTable');refs(entry,'attributeIndices','attributeTable')}
 for(const raw of dictionary.functionTable)for(const key of ['nameStrindex','systemNameStrindex','filenameStrindex'])ref(object(raw),key,'stringTable')
 for(const raw of dictionary.attributeTable){const entry=object(raw);ref(entry,'keyStrindex','stringTable');ref(entry,'unitStrindex','stringTable')}
 return {dictionary,record}
}
