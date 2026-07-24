const NUMBER_WORDS = {
	zero: 0,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
	thirteen: 13,
	fourteen: 14,
	fifteen: 15,
	sixteen: 16,
	seventeen: 17,
	eighteen: 18,
	nineteen: 19,
	twenty: 20,
	thirty: 30,
	forty: 40,
	fifty: 50,
	sixty: 60,
	seventy: 70,
	eighty: 80,
	ninety: 90,
	hundred: 100,
};

const NUMBER_WORD =
	'(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)';

const CURRENCY_NORMALIZERS = [
	[/₦|\bngn\b|\bnaira\b/g, ' naira '],
	[/\$|\busd\b|\bdollars?\b/g, ' usd '],
	[/€|\beur\b|\beuros?\b/g, ' eur '],
	[/£|\bgbp\b|\bpounds?\b/g, ' gbp '],
];

function normalizeSurface(value) {
	let text = value.normalize('NFKC').toLowerCase();
	for (const [pattern, replacement] of CURRENCY_NORMALIZERS) {
		text = text.replace(pattern, replacement);
	}
	return text
		.replace(/\bper\s+cent\b/g, '%')
		.replace(/\bpercent\b/g, '%')
		.replace(/(\d),(\d)/g, '$1$2')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseCompoundNumber(words) {
	const meaningful = words.filter((word) => word !== 'and');
	if (meaningful.length === 0) return null;

	let total = 0;
	let current = 0;
	for (const word of meaningful) {
		if (word === 'hundred') {
			current = (current === 0 ? 1 : current) * 100;
			continue;
		}
		const value = NUMBER_WORDS[word];
		if (value === undefined) return null;
		if (value >= 20 && value % 10 === 0) {
			current += value;
		} else if (value < 20) {
			current += value;
		} else {
			return null;
		}
	}
	total += current;
	if (total > 100) return null;
	return total;
}

function extractWordNumbers(text) {
	const values = [];
	const hyphenPattern = new RegExp(`\\b${NUMBER_WORD}(?:-(?:${NUMBER_WORD}))*\\b`, 'g');
	const spacedPattern = new RegExp(`\\b${NUMBER_WORD}(?:\\s+(?:${NUMBER_WORD}))*\\b`, 'g');

	for (const pattern of [hyphenPattern, spacedPattern]) {
		for (const match of text.matchAll(pattern)) {
			const parts = match[0].split(/[\s-]+/);
			const parsed = parseCompoundNumber(parts);
			if (parsed !== null) values.push(parsed);
		}
	}
	return values;
}

function extractNumericTokens(text) {
	const normalized = normalizeSurface(text);
	const values = new Set();
	for (const match of normalized.matchAll(/\d+(?:\.\d+)?/g)) {
		values.add(Number(match[0]));
	}
	for (const value of extractWordNumbers(normalized)) {
		values.add(value);
	}
	return [...values];
}

function anchorNumericValue(anchor) {
	const normalized = normalizeSurface(anchor).replace(/%$/, '');
	if (/^\d+(?:\.\d+)?$/.test(normalized)) {
		return Number(normalized);
	}
	const words = normalized.split(/[\s-]+/).filter(Boolean);
	return parseCompoundNumber(words);
}

function anchorIsPercentage(anchor) {
	return normalizeSurface(anchor).endsWith('%');
}

function anchorIsNumeric(anchor) {
	const normalized = normalizeSurface(anchor);
	return /^\d+(?:\.\d+)?%?$/.test(normalized) || anchorNumericValue(anchor) !== null;
}

function extractPercentageValues(evidenceText) {
	const values = new Set();
	const normalized = normalizeSurface(evidenceText);

	for (const match of normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*%/g)) {
		values.add(Number(match[1]));
	}

	const raw = evidenceText.normalize('NFKC').toLowerCase();
	const wordPercentagePatterns = [
		new RegExp(`\\b(${NUMBER_WORD}(?:-(?:${NUMBER_WORD}))*)\\s*(?:%|per\\s+cent|percent)\\b`, 'g'),
		new RegExp(`\\b(${NUMBER_WORD}(?:\\s+(?:and\\s+)?${NUMBER_WORD})*)\\s*(?:%|per\\s+cent|percent)\\b`, 'g'),
	];
	for (const pattern of wordPercentagePatterns) {
		for (const match of raw.matchAll(pattern)) {
			const parts = match[1].split(/[\s-]+/);
			const parsed = parseCompoundNumber(parts);
			if (parsed !== null) values.add(parsed);
		}
	}

	return values;
}

function evidenceContainsPercentage(evidenceText, anchor) {
	const target = anchorNumericValue(anchor);
	if (target === null) return false;
	return extractPercentageValues(evidenceText).has(target);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function evidenceContainsTextAnchor(normalizedEvidence, normalizedAnchor) {
	if (!normalizedAnchor) return false;
	const escaped = escapeRegExp(normalizedAnchor);
	const pattern = new RegExp(`(^|[^a-z0-9%])${escaped}([^a-z0-9%]|$)`);
	return pattern.test(normalizedEvidence);
}

export function evidenceContainsAnchor(evidenceText, anchor) {
	const normalizedEvidence = normalizeSurface(evidenceText);
	const normalizedAnchor = normalizeSurface(anchor);
	if (!normalizedAnchor) return false;

	if (anchorIsPercentage(anchor)) {
		return evidenceContainsPercentage(evidenceText, anchor);
	}

	if (anchorIsNumeric(anchor)) {
		const target = anchorNumericValue(anchor);
		if (target === null) return false;
		return extractNumericTokens(normalizedEvidence).includes(target);
	}

	return evidenceContainsTextAnchor(normalizedEvidence, normalizedAnchor);
}
