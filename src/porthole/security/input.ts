import { fail } from './authority'
export async function input(request: Request): Promise<Record<string, unknown>> {
 const type = request.headers.get('content-type')?.split(';')[0]
 if (!['application/json','application/x-www-form-urlencoded'].includes(type ?? '')) fail('unsupported_media_type', 415)
 const reader = request.body?.getReader()
 if (!reader) fail('invalid_input', 400)
 const chunks: Uint8Array[] = []; let size = 0
 while (true) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); fail('input_too_large',413) }; chunks.push(value) }
 const bytes = new Uint8Array(size); let offset=0
 for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length }
 try {
  const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes)
  if (type === 'application/json') {
   const data: unknown = JSON.parse(text)
   if (!data || typeof data !== 'object' || Array.isArray(data)) fail('invalid_input',400)
   const stack: (Set<string> | null)[] = []
   for (const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]]/g)) {
    const part=token[0]
    if (part === '{') stack.push(new Set()); else if (part === '[') stack.push(null); else if (part === '}' || part === ']') stack.pop()
    else if (/^\s*:/.test(text.slice(token.index! + part.length))) { const keys=stack.at(-1)!,key=JSON.parse(part) as string; if(keys.has(key)) fail('invalid_input',400);keys.add(key) }
   }
   return data as Record<string, unknown>
  }
  const data: Record<string,unknown> = Object.create(null)
  for (const [key,value] of new URLSearchParams(text)) { if (Object.hasOwn(data,key)) fail('invalid_input',400); data[key]=value }
  return data
 } catch { return fail('invalid_input',400) }
}
export const text = (value: unknown, max=120) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : fail('invalid_input',400)
