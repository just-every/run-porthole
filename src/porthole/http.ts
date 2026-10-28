import { agentStatsResponse } from './metrics/agent-stats/http'
import { metricRuleResponse } from './metrics/span-rules/http'
import { sloResponse } from './slos/http'
import { followUpResponse } from './follow-up/http'
import { retentionResponse } from './retention/http'
import { subjectErasureResponse } from './privacy/erasure/http'
import { integrationRegistryResponse } from './integrations/registry/http'
import { publicationResponse } from './publication/http'
import { apiResponse } from './api/http'
import { dashboardResponse } from './dashboards/http'
import { migrationResponse } from './migration/http'
import { runtimeBindings, type Bindings } from '../auth.server'
import { auditResponse } from './audit/http'
import { personalTokenResponse } from './membership/token'
import { membershipResponse } from './membership/http'
import { credentialResponse } from './credentials/http'
import { ingestResponse } from './ingest/http'
import { archiveResponse } from './portability/http'
import { analyticalResponse } from './analytical/http'
import { baggageResponse } from './traces/policy'
import { traceResponse } from './traces/http'
import { signalExportResponse } from './exports'
import { queryResponse } from './query/http'
import { mcpResponse } from './agents/mcp'
import { objectsResponse } from './objects/http'
import { erasureResponse } from './privacy/actor-erasure/http'
import { bucketHistoryResponse } from './storage/http'
import { healthResponse } from './health/http'

export async function portholeResponse(request: Request, bindings: Bindings): Promise<Response | null> {
 const env = runtimeBindings(bindings), url = new URL(request.url)
 if(url.pathname==='/api/porthole/v1/session') return personalTokenResponse(request,env)
 const product=await agentStatsResponse(request,env) ?? await metricRuleResponse(request,env) ?? await sloResponse(request,env) ?? await followUpResponse(request,env) ?? await retentionResponse(request,env) ?? await subjectErasureResponse(request,env) ?? await integrationRegistryResponse(request,env) ?? await baggageResponse(request,env) ?? await publicationResponse(request,env) ?? await apiResponse(request,env) ?? await dashboardResponse(request,env) ?? await signalExportResponse(request,env) ?? await migrationResponse(request,env) ?? await analyticalResponse(request,env) ?? await traceResponse(request,env) ?? await bucketHistoryResponse(request,env) ?? await ingestResponse(request,env) ?? await archiveResponse(request,env) ?? await queryResponse(request,env) ?? await mcpResponse(request,env) ?? await objectsResponse(request,env) ?? await erasureResponse(request,env)
 if(product)return product
 if (url.pathname.startsWith('/app/settings') || url.pathname==='/api/porthole/v1/credential') return await membershipResponse(request,env) ?? await credentialResponse(request,env)
 if(url.pathname.startsWith('/api/v1/health') || url.pathname.startsWith('/app/health'))return healthResponse(request,env)
 if (!['/app/audit', '/app/health', '/api/v1/audit', '/api/v1/audit/export', '/api/v1/health'].includes(url.pathname)) return null
 // Native auth enforces this too; check before touching the audit database so
 // a foreign origin cannot create entries or infer a private ledger checkpoint.
 if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host')?.toLowerCase() !== url.host.toLowerCase()) || request.headers.get('sec-fetch-site') === 'cross-site') {
  return Response.json({ error: 'invalid_origin' }, { status: 403, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })
 }
 return await auditResponse(request, env) ?? await healthResponse(request, env)
}
