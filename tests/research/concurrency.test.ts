import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../../.flue/research/concurrency';

describe('mapWithConcurrency', () => {
	it('never exceeds the configured concurrent worker count', async () => {
		let active = 0;
		let maxActive = 0;
		const items = Array.from({ length: 20 }, (_, i) => i);

		await mapWithConcurrency(items, 3, async (item) => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((r) => setTimeout(r, 10));
			active--;
			return item * 2;
		});

		expect(maxActive).toBeLessThanOrEqual(3);
	});
});
