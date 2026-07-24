export const RUN_FEED_STATES = {
	CONNECTING: 'connecting',
	CATCHING_UP: 'catching-up',
	LIVE: 'live',
	STALE: 'stale',
	DISCONNECTED: 'disconnected',
	TERMINAL: 'terminal',
};

export const TERMINAL_RUN_STATUSES = new Set(['completed', 'errored']);

/**
 * @param {unknown} error
 */
export function safeConnectionClass(error) {
	const message = error instanceof Error ? error.message : String(error);
	if (/ECONNREFUSED/i.test(message)) return 'connection_refused';
	if (/ENOTFOUND/i.test(message)) return 'host_not_found';
	if (/ETIMEDOUT|timeout/i.test(message)) return 'timeout';
	if (/401|403|unauthorized|forbidden/i.test(message)) return 'auth_failed';
	return 'connection_error';
}

export class RunFeedConnectionError extends Error {
	/**
	 * @param {string} runId
	 * @param {string} errorClass
	 * @param {unknown} [cause]
	 */
	constructor(runId, errorClass, cause) {
		super(`Unable to connect to the Flue run server for ${runId}: ${errorClass}`);
		this.name = 'RunFeedConnectionError';
		this.errorClass = errorClass;
		this.cause = cause;
	}
}

export class RunFeedDisconnectedError extends Error {
	/**
	 * @param {string} runId
	 * @param {string} errorClass
	 * @param {string | null} lastPersistedEventAt
	 */
	constructor(runId, errorClass, lastPersistedEventAt) {
		super(`Run feed disconnected for ${runId}: ${errorClass}`);
		this.name = 'RunFeedDisconnectedError';
		this.errorClass = errorClass;
		this.lastPersistedEventAt = lastPersistedEventAt;
	}
}

/**
 * @param {AbortSignal | undefined} parent
 */
function createLinkedAbortSignal(parent) {
	const controller = new AbortController();
	if (parent) {
		if (parent.aborted) controller.abort(parent.reason);
		else parent.addEventListener('abort', () => controller.abort(parent.reason), { once: true });
	}
	return controller;
}

/**
 * @param {unknown} event
 */
function eventTimestamp(event) {
	return typeof event?.timestamp === 'string' ? event.timestamp : null;
}

/**
 * @param {import('@flue/sdk').FlueEvent[]} events
 * @param {string} offset
 * @param {{ signal?: AbortSignal, hang?: boolean }} [options]
 */
export function eventStream(events, offset, options = {}) {
	return {
		async *[Symbol.asyncIterator]() {
			if (options.hang) {
				await new Promise((_, reject) => {
					const onAbort = () => reject(new Error('aborted'));
					if (options.signal?.aborted) {
						onAbort();
						return;
					}
					options.signal?.addEventListener('abort', onAbort, { once: true });
				});
			}
			for (const event of events) yield event;
		},
		offset,
		cancel() {},
	};
}

/**
 * @param {{
 *   client: {
 *     runs: {
 *       get: (runId: string) => Promise<Record<string, unknown>>;
 *       stream: (runId: string, options?: Record<string, unknown>) => AsyncIterable<unknown> & { offset: string; cancel?: (reason?: unknown) => void };
 *     };
 *   };
 *   runId: string;
 *   signal?: AbortSignal;
 *   reconcileAfterMs?: number;
 *   onState?: (payload: Record<string, unknown>) => void;
 * }} options
 */
export function createResearchRunFeed({
	client,
	runId,
	signal,
	reconcileAfterMs = 60_000,
	onState,
}) {
	/** @type {Record<string, unknown> | null} */
	let runRecord = null;
	/** @type {string | null} */
	let checkpoint = null;
	/** @type {string | null} */
	let lastPersistedEventAt = null;
	/** @type {number | null} */
	let lastIngestedAt = null;

	const feed = {
		get runRecord() {
			return runRecord;
		},
		get checkpoint() {
			return checkpoint;
		},
		get lastPersistedEventAt() {
			return lastPersistedEventAt;
		},
		get lastIngestedAt() {
			return lastIngestedAt;
		},
		/** @deprecated use lastPersistedEventAt */
		get lastEventAt() {
			return lastIngestedAt;
		},
		async *[Symbol.asyncIterator]() {
			const recordActivity = (event) => {
				const persistedAt = eventTimestamp(event);
				if (persistedAt) lastPersistedEventAt = persistedAt;
				lastIngestedAt = Date.now();
			};

			const persistedEventAgeMs = () => {
				if (!lastPersistedEventAt) return Number.POSITIVE_INFINITY;
				return Date.now() - Date.parse(lastPersistedEventAt);
			};

			const emitDisconnected = (errorClass) => {
				onState?.({
					state: RUN_FEED_STATES.DISCONNECTED,
					runId,
					lastEventAt: lastPersistedEventAt,
					errorClass,
				});
				throw new RunFeedDisconnectedError(runId, errorClass, lastPersistedEventAt);
			};

			onState?.({ state: RUN_FEED_STATES.CONNECTING, runId });
			try {
				runRecord = await client.runs.get(runId);
			} catch (error) {
				const errorClass = safeConnectionClass(error);
				throw new RunFeedConnectionError(runId, errorClass, error);
			}

			onState?.({ state: RUN_FEED_STATES.CATCHING_UP, runId, runRecord });
			const catchup = client.runs.stream(runId, { live: false, signal });
			for await (const event of catchup) {
				recordActivity(event);
				yield event;
				if (event?.type === 'run_end') {
					onState?.({ state: RUN_FEED_STATES.TERMINAL, runId, runRecord });
					return;
				}
			}
			checkpoint = catchup.offset;

			if (TERMINAL_RUN_STATUSES.has(String(runRecord.status))) {
				onState?.({ state: RUN_FEED_STATES.TERMINAL, runId, runRecord });
				return;
			}

			onState?.({ state: RUN_FEED_STATES.LIVE, runId, runRecord });
			const liveAbort = createLinkedAbortSignal(signal);
			const live = client.runs.stream(runId, {
				live: true,
				offset: checkpoint,
				signal: liveAbort.signal,
			});

			let reconciling = false;
			let recoverTerminal = false;
			let disconnected = false;
			let disconnectErrorClass = 'connection_error';
			let sawRunEnd = false;
			/** @type {unknown[]} */
			const pendingEvents = [];
			/** @type {ReturnType<typeof setInterval> | null} */
			let reconcileTimer = null;

			const stopLive = (reason) => {
				liveAbort.abort(reason);
				live.cancel?.(reason);
			};

			const drainFiniteStream = async (streamOptions) => {
				const stream = client.runs.stream(runId, streamOptions);
				if (!stream?.[Symbol.asyncIterator]) {
					return { events: [], offset: streamOptions.offset ?? checkpoint };
				}
				/** @type {unknown[]} */
				const events = [];
				for await (const event of stream) {
					events.push(event);
				}
				return { events, offset: stream.offset };
			};

			const reconcile = async () => {
				if (reconciling || recoverTerminal || disconnected || sawRunEnd) return;
				if (persistedEventAgeMs() < reconcileAfterMs) return;
				reconciling = true;
				try {
					let latest;
					try {
						latest = await client.runs.get(runId);
					} catch {
						disconnected = true;
						disconnectErrorClass = 'connection_error';
						stopLive('disconnected');
						return;
					}

					const resumeOffset = live.offset ?? checkpoint;
					if (!TERMINAL_RUN_STATUSES.has(String(latest.status))) {
						let refresh = { events: [], offset: resumeOffset };
						try {
							refresh = await drainFiniteStream({
								live: false,
								offset: resumeOffset,
								signal,
							});
						} catch {
							refresh = { events: [], offset: resumeOffset };
						}
						if (refresh.events.length > 0) {
							checkpoint = refresh.offset;
							pendingEvents.push(...refresh.events);
							return;
						}
						onState?.({
							state: RUN_FEED_STATES.STALE,
							runId,
							lastEventAt: lastPersistedEventAt,
							runRecord: latest,
						});
						return;
					}

					runRecord = latest;
					recoverTerminal = true;
					onState?.({ state: RUN_FEED_STATES.TERMINAL, runId, runRecord: latest });
					stopLive('terminal-recovered');
				} finally {
					reconciling = false;
				}
			};

			reconcileTimer = setInterval(() => {
				void reconcile();
			}, Math.min(reconcileAfterMs, 5_000));

			const liveIterator = live[Symbol.asyncIterator]();

			try {
				while (!recoverTerminal && !disconnected && !sawRunEnd) {
					while (pendingEvents.length > 0) {
						const event = pendingEvents.shift();
						recordActivity(event);
						onState?.({ state: RUN_FEED_STATES.LIVE, runId, runRecord });
						yield event;
						if (event?.type === 'run_end') {
							sawRunEnd = true;
							onState?.({ state: RUN_FEED_STATES.TERMINAL, runId, runRecord });
							return;
						}
					}

					const next = await liveIterator.next();
					if (next.done) break;
					const event = next.value;
					recordActivity(event);
					onState?.({ state: RUN_FEED_STATES.LIVE, runId, runRecord });
					yield event;
					if (event?.type === 'run_end') {
						sawRunEnd = true;
						onState?.({ state: RUN_FEED_STATES.TERMINAL, runId, runRecord });
						return;
					}
				}
			} catch {
				if (!recoverTerminal && !disconnected) {
					disconnected = true;
					disconnectErrorClass = 'connection_error';
				}
			} finally {
				if (reconcileTimer) clearInterval(reconcileTimer);
			}

			if (disconnected) {
				emitDisconnected(disconnectErrorClass);
			}

			if (!sawRunEnd && !recoverTerminal) {
				try {
					const latest = await client.runs.get(runId);
					if (TERMINAL_RUN_STATUSES.has(String(latest.status))) {
						runRecord = latest;
						recoverTerminal = true;
						onState?.({ state: RUN_FEED_STATES.TERMINAL, runId, runRecord: latest });
					}
				} catch {
					emitDisconnected('connection_error');
				}
			}

			if (recoverTerminal) {
				const recovery = await drainFiniteStream({
					live: false,
					offset: live.offset ?? checkpoint,
					signal,
				});
				for (const event of recovery.events) {
					recordActivity(event);
					yield event;
				}
				checkpoint = recovery.offset;
			}
		},
	};

	return feed;
}

export function engineStatusFromRunEnd(event) {
	if (event?.type !== 'run_end') return 'active';
	return event.isError ? 'errored' : 'completed';
}
