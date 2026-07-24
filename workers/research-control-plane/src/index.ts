import { DiscoveryRunRequestSchema } from '../../../.flue/research/schemas';
import { authorizeResearchAdminRequest } from '../../../.flue/auth/research-admin';
import * as v from 'valibot';
import { MarketIntelligenceScanWorkflow } from './workflows/market-intelligence-scan';
import { ResearchRunState } from './state/research-run-state';

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return Response.json({ ok: true });
		}

		const authFailure = await authorizeResearchAdminRequest(
			request,
			env.RESEARCH_ADMIN_TOKEN,
		);
		if (authFailure) {
			return authFailure;
		}

		if (url.pathname === '/v1/research/scans' && request.method === 'POST') {
			const body = await request.json();
			const input = v.parse(DiscoveryRunRequestSchema, body);
			const instance = await env.MARKET_INTELLIGENCE_SCAN.create({
				params: { request: input },
			});
			return Response.json(
				{
					workflowInstanceId: instance.id,
					runKey: input.runKey,
					status: 'accepted',
					statusUrl: `/v1/research/scans/${instance.id}`,
				},
				{ status: 202 },
			);
		}

		if (url.pathname.startsWith('/v1/research/scans/') && request.method === 'GET') {
			const workflowInstanceId = url.pathname.split('/').pop();
			if (!workflowInstanceId) {
				return Response.json({ error: 'Missing workflow instance id' }, { status: 400 });
			}
			const instance = await env.MARKET_INTELLIGENCE_SCAN.get(workflowInstanceId);
			const status = await instance.status();
			return Response.json({
				workflowInstanceId,
				status: status.status,
				output: status.output ?? null,
			});
		}

		return new Response('Not Found', { status: 404 });
	},
};

export { MarketIntelligenceScanWorkflow, ResearchRunState };

interface Env {
	RESEARCH_ADMIN_TOKEN: string;
	RESEARCH_RUN_STATE: DurableObjectNamespace<ResearchRunState>;
	MARKET_INTELLIGENCE_SCAN: Workflow<{
		request: unknown;
	}>;
	PUBLICATION_AGENT: Fetcher;
}
