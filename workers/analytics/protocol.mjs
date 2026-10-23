export const limits = Object.freeze({ bodyBytes: 2 * 1024 * 1024, batches: 20, records: 10000, page: 200, responseBytes: 2 * 1024 * 1024 });
export class AnalyticalError extends Error {
 constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const fail = (code, status = 400) => { throw new AnalyticalError(code, status); };
export function object(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_message');
 return value;
}
export function keys(value, allowed) {
 object(value);
 if (Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_message');
}
export function text(value, max = 256, allowEmpty = false) {
 if (typeof value !== 'string' || (!allowEmpty && !value.length) || value.length > max || /[\x00-\x1f]/.test(value)) fail('invalid_string');
 return value;
}
export function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
 if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_integer');
 return value;
}
export function nano(value) {
 if (typeof value !== 'string' || !/^\d{1,20}$/.test(value) || BigInt(value) > 18446744073709551615n) fail('invalid_nanosecond_timestamp');
 return value.padStart(20, '0');
}
export function signal(value) {
 if (!['logs', 'metrics', 'traces', 'profiles'].includes(value)) fail('invalid_signal');
 return value;
}
export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
export async function digest(value) {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function authenticate(request, env) {
 // Hash fixed-size values before comparison; no secret or token is returned.
 if (typeof env.ANALYTICS_TOKEN !== 'string' || !env.ANALYTICS_TOKEN.length) fail('analytics_not_configured', 503);
 const header = request.headers.get('authorization') ?? '';
 if (!header.startsWith('Bearer ') || header.length > 4096) fail('unauthorized', 401);
 const [actual, expected] = await Promise.all([digest(header.slice(7)), digest(env.ANALYTICS_TOKEN)]);
 let difference = 0;
 for (let n = 0; n < actual.length; n++) difference |= actual.charCodeAt(n) ^ expected.charCodeAt(n);
 if (difference) fail('unauthorized', 401);
}
export async function body(request) {
 if (!(request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase().endsWith('/json')) fail('json_required', 415);
 const reader = request.body?.getReader();
 if (!reader) fail('body_required');
 const chunks = []; let size = 0;
 try {
  for (;;) {
   const { done, value } = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > limits.bodyBytes) { await reader.cancel(); fail('body_too_large', 413); }
   chunks.push(value);
  }
 } finally { reader.releaseLock(); }
 const bytes = new Uint8Array(size); let offset = 0;
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
 try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
 catch (error) { if (error instanceof AnalyticalError) throw error; fail('invalid_json'); }
}
export const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
