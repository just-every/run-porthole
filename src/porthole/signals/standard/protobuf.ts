import { bytes, fields, uint, utf8, type Field } from '../../ingest/wire'
import { fail } from '../../security/authority'

export const concat = (parts:Uint8Array[]) => {
 const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0
 for(const part of parts){result.set(part,offset);offset+=part.length}return result
}
export function varint(value:bigint|number) {
 let n=BigInt.asUintN(64,BigInt(value));const result=[]
 do{result.push(Number(n&127n)|(n>127n?128:0));n>>=7n}while(n)
 return new Uint8Array(result)
}
export const integer=(number:number,value:bigint|number)=>concat([varint(number*8),varint(value)])
export const message=(number:number,value:Uint8Array)=>concat([varint(number*8+2),varint(value.length),value])
export const text=(number:number,value:string)=>message(number,new TextEncoder().encode(value))
export function float(number:number,value:number,bits?:string) {
 const data=new Uint8Array(8)
 if(bits){for(let i=0;i<8;i++)data[i]=parseInt(bits.slice(i*2,i*2+2),16)}
 else new DataView(data.buffer).setFloat64(0,value,true)
 return concat([varint(number*8+1),data])
}
export function typed(field:Field,wire:number) {
 if(field.wire!==wire)fail('invalid_standard_protobuf',400)
 return field
}
export const messages=(input:Uint8Array,number:number)=>fields(input).filter(f=>f.number===number).map(f=>bytes(typed(f,2)))
export const scalar=(f:Field)=>uint(typed(f,0))
export const string=(f:Field)=>utf8(bytes(typed(f,2)))
/** Literal-only raw Snappy is deliberately simple and interoperable. Decoding
 * remains bounded by the shared intake codec. */
export function snappy(input:Uint8Array) {
 if(!input.length)return varint(0)
 const n=input.length-1,tag=n<60?new Uint8Array([n<<2]):n<256?new Uint8Array([240,n]):n<65536?new Uint8Array([244,n&255,n>>8]):new Uint8Array([248,n&255,(n>>8)&255,n>>16])
 return concat([varint(input.length),tag,input])
}
