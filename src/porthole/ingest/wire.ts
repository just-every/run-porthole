import { IntakeError, invalid } from './model'

export const maxBytes = 1024 * 1024
/** Strict protobuf wire reader. Unknown fields survive in the retained envelope;
 * malformed lengths, groups, truncated fixed fields and overflowing varints fail. */
export class Proto {
 position = 0
 constructor(readonly bytes: Uint8Array) {}
 varint(): bigint {
  let value = 0n
  for (let n = 0; n < 10; n++) {
   const byte = this.bytes[this.position++]
   if (byte === undefined || n === 9 && byte > 1) return invalid('invalid_protobuf_varint')
   value |= BigInt(byte & 127) << BigInt(7 * n)
   if (!(byte & 128)) return value
  }
  return invalid('invalid_protobuf_varint')
 }
 take(size: number): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0 || this.position + size > this.bytes.length) return invalid('truncated_protobuf')
  const value = this.bytes.subarray(this.position, this.position + size); this.position += size; return value
 }
 fields(): Field[] {
  const result: Field[] = []
  while (this.position < this.bytes.length) {
   const tag = this.varint(), number = Number(tag >> 3n), wire = Number(tag & 7n)
   if (!number || number > 536870911) return invalid('invalid_protobuf_tag')
   const value = wire === 0 ? this.varint() : wire === 1 ? this.take(8) : wire === 2 ? this.take(Number(this.varint())) : wire === 5 ? this.take(4) : invalid('unsupported_protobuf_wire_type')
   result.push({ number, wire, value })
  }
  return result
 }
}
export interface Field { number: number; wire: number; value: bigint | Uint8Array }
export const fields = (bytes: Uint8Array) => new Proto(bytes).fields()
export function bytes(field: Field): Uint8Array { return field.value instanceof Uint8Array ? field.value : invalid('invalid_protobuf_field') }
export function utf8(value: Uint8Array): string { try { return new TextDecoder('utf-8', { fatal: true }).decode(value) } catch { return invalid('invalid_utf8') } }
export const hex = (value: Uint8Array) => [...value].map(n => n.toString(16).padStart(2, '0')).join('')
export const uint = (field: Field) => typeof field.value === 'bigint' ? field.value : invalid('invalid_protobuf_field')
export const fixed = (field: Field) => { const b = bytes(field); return b.length === 8 ? new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(0, true) : invalid('invalid_fixed64') }
export const double = (field: Field) => { const b = bytes(field); return b.length === 8 ? new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat64(0, true) : invalid('invalid_double') }

/** Raw Snappy block format, as required by remote-write and Loki (not framed). */
export function unsnappy(input: Uint8Array): Uint8Array {
 const reader = new Proto(input), length = Number(reader.varint())
 if (length > maxBytes) return invalid('decompressed_body_too_large', 413)
 const output = new Uint8Array(length); let offset = 0
 while (reader.position < input.length) {
  const tag = reader.take(1)[0], kind = tag & 3
  let count: number, distance = 0
  if (kind === 0) {
   count = tag >> 2
   if (count < 60) count++
   else { const encoded = reader.take(count - 59); count = 1; for (let i = 0; i < encoded.length; i++) count += encoded[i] * 2 ** (8 * i) }
   if (offset + count > length) return invalid('invalid_snappy_length')
   output.set(reader.take(count), offset); offset += count; continue
  }
  if (kind === 1) { count = 4 + ((tag >> 2) & 7); distance = ((tag & 224) << 3) + reader.take(1)[0] }
  else { count = 1 + (tag >> 2); const encoded = reader.take(kind === 2 ? 2 : 4); for (let i = 0; i < encoded.length; i++) distance += encoded[i] * 2 ** (8 * i) }
  if (!distance || distance > offset || offset + count > length) return invalid('invalid_snappy_copy')
  for (let i = 0; i < count; i++) { output[offset] = output[offset - distance]; offset++ }
 }
 if (offset !== length) return invalid('invalid_snappy_length')
 return output
}
export async function readBytes(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
 if (!stream) return new Uint8Array()
 const reader = stream.getReader(), chunks: Uint8Array[] = []; let length = 0
 try {
  while (true) {
   const { value, done } = await reader.read(); if (done) break
   length += value.length
   if (length > maxBytes) { await reader.cancel(); return invalid('body_too_large', 413) }
   chunks.push(value)
  }
 } catch (error) { if (error instanceof IntakeError) throw error; return invalid('invalid_compressed_body') }
 const output = new Uint8Array(length); let offset = 0
 for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
 return output
}
