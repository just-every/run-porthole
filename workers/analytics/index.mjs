import { AnalyticalError, LogSearchError, authenticate, body, fail, json } from './protocol.mjs';
import { control, coverageRequest, health, state } from './coverage.mjs';
import { query } from './query.mjs';
import { replicate } from './replicate.mjs';

export default {
 async fetch(request, env) {
  try {
   const url = new URL(request.url);
   if (url.search) fail('invalid_query');
   if (request.method === 'GET' && url.pathname === '/health') {
    await state(env.DB);
    return json({ ok: true, status: 'ok', deployment: { sourceSha: env.RER_DEPLOY_SOURCE, fingerprint: env.RER_DEPLOY_FINGERPRINT, versionId: env.RER_VERSION?.id } });
   }
   await authenticate(request, env);
   if (request.method === 'GET' && ['/v1/health', '/v1/manifest'].includes(url.pathname)) {
    const result = await health(env.DB);
    return json(url.pathname === '/v1/manifest' ? { schema: 1, kind: 'porthole-analytics', role: env.ANALYTICS_ROLE, ...result } : result);
   }
   if (request.method !== 'POST') fail('not_found', 404);
   const handler = { '/v1/replicate': replicate, '/v1/query': query, '/v1/coverage': coverageRequest, '/v1/control': control }[url.pathname];
   if (!handler) fail('not_found', 404);
   return json(await handler(env.DB, await body(request)));
  } catch (error) {
   const known = error instanceof AnalyticalError || error instanceof LogSearchError;
   return json({ error: known ? error.code : 'analytics_unavailable', ...(error instanceof LogSearchError ? {field:error.field,hint:error.hint} : {}) }, known ? error.status : 503);
  }
 },
};
