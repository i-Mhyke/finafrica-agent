import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getApiProvider,
	getModel,
	type AssistantMessageEvent,
} from '@earendil-works/pi-ai/compat';
import '../../.flue/workflows/market-intelligence-scan';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('OpenAI-compatible model stream recovery', () => {
	it('marks a stream without finish_reason as a transient network error', async () => {
		const body = [
			'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"partial"},"finish_reason":null}]}',
			'',
			'data: [DONE]',
			'',
		].join('\n');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(body, {
				status: 200,
				headers: { 'content-type': 'text/event-stream' },
			})),
		);
		const provider = getApiProvider('openai-completions');
		const model = getModel('opencode-go', 'deepseek-v4-flash');
		expect(provider).toBeDefined();
		expect(model).toBeDefined();

		const events: AssistantMessageEvent[] = [];
		for await (const event of provider!.stream(
			model!,
			{
				messages: [
					{ role: 'user', content: 'Finish this response.', timestamp: Date.now() },
				],
			},
			{ apiKey: 'test-key' },
		)) {
			events.push(event);
		}

		const terminal = events.at(-1);
		expect(terminal?.type).toBe('error');
		if (terminal?.type !== 'error') throw new Error('Expected terminal error event');
		expect(terminal.error.errorMessage).toBe(
			'Network error: stream ended without finish_reason',
		);
	});
});
