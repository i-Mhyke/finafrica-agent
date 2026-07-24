/**
 * Model registry for publication agents.
 *
 * OpenCode Go OpenAI-compatible models use the built-in `opencode-go` provider
 * (OPENCODE_API_KEY). OpenAI models use the built-in `openai` provider
 * (OPENAI_API_KEY). Both are catalog-backed in pi-ai — no custom registration.
 *
 * @see https://opencode.ai/docs/go/
 */

/** OpenCode Go models exposed via `/v1/chat/completions` only. */
export const OPENCODE_GO_OPENAI_MODELS = [
	'deepseek-v4-flash',
	'deepseek-v4-pro',
	'glm-5.1',
	'glm-5.2',
	'grok-4.5',
	'kimi-k2.6',
	'kimi-k2.7-code',
	'kimi-k3',
	'mimo-v2.5',
	'mimo-v2.5-pro',
] as const;

export type OpencodeGoOpenAIModel = (typeof OPENCODE_GO_OPENAI_MODELS)[number];

export type ModelSpecifier = `opencode-go/${OpencodeGoOpenAIModel}` | `openai/${string}`;

/** Role → default model. Override per agent or per prompt as needed. */
export const models = {
	/** High-volume, low-cost work (triage, summarization, drafts). */
	fast: 'opencode-go/deepseek-v4-flash' satisfies ModelSpecifier,

	/** Agentic coding / tool use. */
	coding: 'opencode-go/kimi-k2.7-code' satisfies ModelSpecifier,

	/** Balanced default for research workflows. */
	default: 'opencode-go/kimi-k2.6' satisfies ModelSpecifier,

	/** Editorial synthesis from normalized evidence. */
	analysis: 'opencode-go/grok-4.5' satisfies ModelSpecifier,

	/** Heavier reasoning when OpenCode quota allows. */
	reasoning: 'opencode-go/kimi-k3' satisfies ModelSpecifier,

	/** Premium fallback — editorial quality, complex synthesis. */
	premium: 'openai/gpt-5.2' satisfies ModelSpecifier,
} as const;

export type ModelRole = keyof typeof models;

export const researchModelRoles = {
	coordinator: 'fast',
	discovery: 'fast',
	discoveryDecision: 'fast',
	discoveryFinalizer: 'fast',
	briefValidator: 'fast',
	briefRefiner: 'fast',
	regionResearcher: 'fast',
	structuralAnalyst: 'fast',
	researchReviewer: 'analysis',
} as const satisfies Record<string, ModelRole>;

export function model(role: ModelRole = 'default'): ModelSpecifier {
	return models[role];
}

export function opencodeGo(modelId: OpencodeGoOpenAIModel): ModelSpecifier {
	return `opencode-go/${modelId}`;
}

export function openai(modelId: string): ModelSpecifier {
	return `openai/${modelId}`;
}
