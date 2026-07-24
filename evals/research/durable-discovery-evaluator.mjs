export function evaluateDurableDiscoveryCase(testCase, events = []) {
	const duplicateProviderCalls = events.filter(
		(event) => event.eventType === 'provider_observation',
	).length;
	return {
		id: testCase.id,
		passed:
			(testCase.expect.duplicateProviderCalls ?? 0) >= duplicateProviderCalls &&
			events.length > 0,
		metrics: {
			duplicateProviderCalls,
			eventCount: events.length,
		},
	};
}
