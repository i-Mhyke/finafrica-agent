export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (limit < 1) throw new Error('Concurrency limit must be at least 1');
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function runWorker(): Promise<void> {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	}

	const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
	await Promise.all(workers);
	return results;
}
