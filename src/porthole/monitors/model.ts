import {fail} from '../security/authority'
export const dimensions=['service','environment','team'] as const
export type Dimension=typeof dimensions[number]
export interface Definition {signal:'logs'|'traces'|'metrics';operator:'above'|'below';threshold:number;windowSeconds:number;windows:number[];pendingSeconds:number;recoveryThreshold:number;groupBy:Dimension[];noDataPolicy:'unknown'|'alert'|'keep-last'}
export type Status='Healthy'|'Firing'|'Pending'|'Unknown'|'NoData'
export type Completeness='measured'|'absent'|'source-loss'|'uncertain-time'|'unavailable'|'incomplete'
export interface Window {windowSeconds:number;count:number|null;completeness:Completeness}
export interface Group {key:string;labels:Partial<Record<Dimension,string>>;status:Status;count:number|null;lastKnownCount:number|null;pendingSince:number|null;firingEpisode:string|null;completeness:Completeness;windows:Window[];reason:string}
export interface Evaluation {monitorId:string;revision:number;evaluatedAt:number;status:Status;observedCount:number|null;lastKnownCount:number|null;lastKnownAt:number|null;firingEpisode:string|null;reason:string;groups:Group[];snapshot:number}
export function monitorDefinition(body:Record<string,unknown>):Definition {
 const allowed=['signal','operator','threshold','windowSeconds','windows','pendingSeconds','recoveryThreshold','groupBy','noDataPolicy']
 const integer=(value:unknown,min:number,max:number)=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max
 if(Object.keys(body).some(key=>!allowed.includes(key))||!['logs','metrics','traces'].includes(String(body.signal))||!['above','below'].includes(String(body.operator))||typeof body.threshold!=='number'||!Number.isFinite(body.threshold)||!integer(body.windowSeconds,1,86400))fail('invalid_definition',400)
 const windows=body.windows??[body.windowSeconds],groupBy=body.groupBy??[],pendingSeconds=body.pendingSeconds??0,recoveryThreshold=body.recoveryThreshold??body.threshold,noDataPolicy=body.noDataPolicy??'unknown'
 if(!Array.isArray(windows)||!windows.length||windows.length>4||windows.some(value=>!integer(value,1,86400))||new Set(windows).size!==windows.length||!windows.includes(body.windowSeconds)||!Array.isArray(groupBy)||groupBy.length>3||groupBy.some(value=>!dimensions.includes(value))||new Set(groupBy).size!==groupBy.length||!integer(pendingSeconds,0,86400)||typeof recoveryThreshold!=='number'||!Number.isFinite(recoveryThreshold)||!['unknown','alert','keep-last'].includes(String(noDataPolicy)))fail('invalid_definition',400)
 if(body.operator==='above'?recoveryThreshold>body.threshold:recoveryThreshold<body.threshold)fail('invalid_hysteresis',400)
 return {signal:body.signal as Definition['signal'],operator:body.operator as Definition['operator'],threshold:body.threshold,windowSeconds:Number(body.windowSeconds),windows:windows as number[],pendingSeconds:Number(pendingSeconds),recoveryThreshold,groupBy:groupBy as Dimension[],noDataPolicy:noDataPolicy as Definition['noDataPolicy']}
}
export const ns=(value:number)=>(BigInt(value)*1000000n).toString().padStart(20,'0')
export const groupKey=(labels:Partial<Record<Dimension,string>>,groupBy:Dimension[])=>JSON.stringify(groupBy.map(key=>[key,labels[key]]))
