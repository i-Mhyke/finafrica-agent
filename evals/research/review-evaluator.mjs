function computePublicationEligible(readiness, structuralPacket, review) {
	const observations = [];

	if (readiness.ready !== true && review.decision === 'PASS') {
		observations.push('review_pass_with_readiness_blocked');
	}
	if (review.packetVersion !== structuralPacket.packetVersion) {
		observations.push('review_packet_version_mismatch');
	}
	if (
		structuralPacket.editorsQuestions.length < 10 ||
		structuralPacket.storyOptions.length < 3 ||
		structuralPacket.storyOptions.length > 5
	) {
		observations.push('review_structure_incomplete');
	}
	const layers = structuralPacket.analysisLayers;
	const layersComplete = Object.values(layers).every((value) => value.trim().length > 0);
	if (!layersComplete) {
		observations.push('review_structure_incomplete');
	}

	const scoreFields = [
		'sourceQuality',
		'factualSupport',
		'structuralAnalysis',
		'reporterVsAnalystTest',
		'libelAndAllegationRisk',
	];
	const scoresBelowThreshold = scoreFields.some((field) => review.scores[field] < 2);
	if (review.decision === 'PASS' && scoresBelowThreshold) {
		observations.push('review_pass_below_required_score');
	}

	const eligible =
		readiness.ready === true &&
		review.decision === 'PASS' &&
		review.packetVersion === structuralPacket.packetVersion &&
		structuralPacket.editorsQuestions.length >= 10 &&
		structuralPacket.storyOptions.length >= 3 &&
		structuralPacket.storyOptions.length <= 5 &&
		layersComplete &&
		!scoresBelowThreshold;

	return { eligible, observations };
}

export function evaluateReviewCase(evalCase) {
	const { readiness, structuralPacket, review } = evalCase.input;
	const failures = [];
	const { eligible, observations } = computePublicationEligible(
		readiness,
		structuralPacket,
		review,
	);

	if (eligible !== evalCase.expected.publicationEligible) {
		failures.push('publication_eligibility_mismatch');
	}

	return {
		passed: failures.length === 0,
		failures,
		observations,
		metrics: {
			publicationEligible: eligible ? 1 : 0,
		},
	};
}
