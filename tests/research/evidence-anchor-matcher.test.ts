import { describe, expect, it } from 'vitest';
import { evidenceContainsAnchor } from '../../.flue/research/evidence-anchor-matcher';

describe('evidenceContainsAnchor', () => {
	it('matches number words and digits across format variants', () => {
		expect(
			evidenceContainsAnchor('Thirty-three banks raised ₦4.65 trillion', '33'),
		).toBe(true);
		expect(
			evidenceContainsAnchor('72.55 per cent was domestic capital', '72.55%'),
		).toBe(true);
	});

	it('rejects unsupported numeric denominators', () => {
		expect(
			evidenceContainsAnchor('72.55 per cent was domestic capital', '70%'),
		).toBe(false);
		expect(evidenceContainsAnchor('Thirty-three banks complied', '37')).toBe(false);
		expect(evidenceContainsAnchor('Thirty seven banks complied', '37')).toBe(true);
	});

	it('keeps percentage anchors distinct from currency amounts', () => {
		expect(
			evidenceContainsAnchor('CBN reported ₦72.55 billion in recapitalisation', '72.55%'),
		).toBe(false);
		expect(
			evidenceContainsAnchor('72.55 per cent was domestic capital', '72.55%'),
		).toBe(true);
	});

	it('does not treat connector words as zero', () => {
		expect(evidenceContainsAnchor('banks and regulators met', '0')).toBe(false);
	});

	it('does not convert word numbers above one hundred', () => {
		expect(evidenceContainsAnchor('two hundred banks complied', '200')).toBe(false);
	});

	it('keeps currency anchors distinct across currencies', () => {
		expect(
			evidenceContainsAnchor('Banks raised $4.65 trillion in recapitalisation', '₦4.65 trillion'),
		).toBe(false);
		expect(
			evidenceContainsAnchor('Banks raised £4.65 trillion in recapitalisation', '₦4.65 trillion'),
		).toBe(false);
		expect(
			evidenceContainsAnchor('Banks raised ₦4.65 trillion in recapitalisation', '₦4.65 trillion'),
		).toBe(true);
	});

	it('matches word-number percentages', () => {
		expect(evidenceContainsAnchor('Thirty-three per cent was domestic capital', '33%')).toBe(
			true,
		);
		expect(evidenceContainsAnchor('Thirty-four per cent was domestic capital', '33%')).toBe(
			false,
		);
	});

	it('matches text anchors on token boundaries only', () => {
		expect(evidenceContainsAnchor('banking sector recapitalisation', 'bank')).toBe(false);
		expect(evidenceContainsAnchor('the bank met minimum capital', 'bank')).toBe(true);
		expect(evidenceContainsAnchor('a rights issue was approved', 'rights issue')).toBe(true);
	});
});
