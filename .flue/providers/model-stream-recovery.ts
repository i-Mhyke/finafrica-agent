import { registerApiProvider } from '@flue/runtime';
import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type AssistantMessageEvent,
	type ProviderStreams,
	type StreamFunction,
	type StreamOptions,
} from '@earendil-works/pi-ai/compat';
import {
	stream as openAICompletionsStream,
	streamSimple as openAICompletionsStreamSimple,
} from '@earendil-works/pi-ai/api/openai-completions';

const INCOMPLETE_STREAM_ERROR = 'Stream ended without finish_reason';
const TRANSIENT_STREAM_ERROR = 'Network error: stream ended without finish_reason';

function normalizeTerminalEvent(event: AssistantMessageEvent): AssistantMessageEvent {
	if (
		event.type !== 'error' ||
		!event.error.errorMessage?.includes(INCOMPLETE_STREAM_ERROR)
	) {
		return event;
	}

	return {
		...event,
		error: {
			...event.error,
			errorMessage: TRANSIENT_STREAM_ERROR,
		},
	};
}

function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes(INCOMPLETE_STREAM_ERROR)
		? TRANSIENT_STREAM_ERROR
		: message;
}

function failedMessage(
	model: Parameters<StreamFunction<'openai-completions'>>[0],
	error: unknown,
): AssistantMessage {
	return {
		role: 'assistant',
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'error',
		errorMessage: errorMessage(error),
		timestamp: Date.now(),
	};
}

function withIncompleteStreamRecovery<TOptions extends StreamOptions>(
	delegate: StreamFunction<'openai-completions', TOptions>,
): StreamFunction<'openai-completions', TOptions> {
	return (model, context, options) => {
		const source = delegate(model, context, options);
		const output = createAssistantMessageEventStream();

		void (async () => {
			try {
				for await (const event of source) {
					output.push(normalizeTerminalEvent(event));
				}
			} catch (error) {
				output.push({
					type: 'error',
					reason: 'error',
					error: failedMessage(model, error),
				});
			} finally {
				output.end();
			}
		})();

		return output;
	};
}

export function registerModelStreamRecovery(): void {
	registerApiProvider({
		api: 'openai-completions',
		stream: withIncompleteStreamRecovery(
			openAICompletionsStream,
		) as ProviderStreams['stream'],
		streamSimple: withIncompleteStreamRecovery(
			openAICompletionsStreamSimple,
		) as ProviderStreams['streamSimple'],
	});
}
