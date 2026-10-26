import type {Json} from '../../../../modules/import-kit/src/types.ts'
export type SourceObject={[key:string]:Json}
export type StreamMessage={event:string;id?:string;data:SourceObject}
export type StreamDefinition={
 id:string;source:'splunk-signalflow-stream';programText:string
 request:{startMs:number;stopMs:number;resolution:number}
 capture:{transport:'sse';body:string}
 comparison:{valueTsId:string;eventTsId?:string;label:string;dimensions:Record<string,string>;tags:string[];inputVariable?:string}
}
export type SourceStream=StreamDefinition&{
 messages:StreamMessage[];metadata:Record<string,SourceObject>;data:StreamMessage[];events:StreamMessage[];info:StreamMessage[];resolutionMs:number
}
export const object=(value:unknown):value is SourceObject=>!!value&&typeof value==='object'&&!Array.isArray(value)
export const identity=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\u0000-\u001f\u007f]/.test(value)
export const timestamp=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=18446744073709
export const numeric=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value))
export const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==='string')&&new Set(value).size===value.length
export const dimensions=(value:unknown):value is Record<string,string>=>object(value)&&Object.values(value).every(item=>typeof item==='string')
export const nanoseconds=(ms:number)=>(BigInt(ms)*1000000n).toString()
