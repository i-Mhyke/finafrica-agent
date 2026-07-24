const BLOCKED_PATTERNS = [
	'access denied',
	'forbidden',
	'enable javascript',
	'sign in',
	'log in',
	'verify you are human',
	'captcha',
	'cookie settings',
];

export function normalizeContent(text: string): string {
	const lines = text
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const lineCounts = new Map<string, number>();
	for (const line of lines) {
		lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
	}

	const filtered = lines.filter((line) => (lineCounts.get(line) ?? 0) < 3);
	return filtered.join('\n').replace(/\s+/g, ' ').trim();
}

export function countNonWhitespaceChars(text: string): number {
	return text.replace(/\s/g, '').length;
}

export function countUniqueWordTokens(text: string): number {
	const words = text.toLowerCase().split(/\s+/).filter(Boolean);
	return new Set(words).size;
}

export interface ExtractionQualityInput {
	content: string;
	title: string;
	finalUrl: string;
	hasError: boolean;
}

export interface ExtractionQualityResult {
	usable: boolean;
	reason: string | null;
}

export function isUsableExtraction(input: ExtractionQualityInput): ExtractionQualityResult {
	if (input.hasError) {
		return { usable: false, reason: 'provider-error' };
	}

	try {
		const parsed = new URL(input.finalUrl);
		if (parsed.protocol !== 'https:') {
			return { usable: false, reason: 'non-https-final-url' };
		}
	} catch {
		return { usable: false, reason: 'invalid-final-url' };
	}

	const normalized = normalizeContent(input.content);
	const charCount = countNonWhitespaceChars(normalized);
	const tokenCount = countUniqueWordTokens(normalized);

	if (charCount < 200 || tokenCount < 40) {
		return { usable: false, reason: 'insufficient-content' };
	}

	const checkText = `${input.title} ${normalized.slice(0, 300)}`.toLowerCase();
	const hasBlockedPattern = BLOCKED_PATTERNS.some((p) => checkText.includes(p));
	if (hasBlockedPattern && charCount < 1500) {
		return { usable: false, reason: 'blocked-page-pattern' };
	}

	return { usable: true, reason: null };
}

export function truncateContent(content: string, maxChars: number): string {
	const normalized = normalizeContent(content);
	if (normalized.length <= maxChars) return normalized;
	return normalized.slice(0, maxChars);
}
