# Research Audit Watcher Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run audit:watch` show accurate live and terminal run state, fail visibly when it cannot connect, attach without replay noise, and agree exactly with the persisted audit export.

**Architecture:** Split event transport from audit projection. The watcher will preflight the run endpoint, perform a silent finite catch-up read, retain the stream's opaque checkpoint, and then subscribe to live events strictly after that checkpoint. A metadata reconciliation probe will distinguish a quiet model turn from a broken connection and recover terminal state if a live stream misses `run_end`.

**Tech Stack:** Node.js 22, `@flue/sdk` 1.0.0-beta.9, Durable Streams, Vitest 4, existing research audit projection and CLI.

## Global Constraints

- The watcher must never call an LLM or web-research provider.
- The watcher must never print `Active` before it has reached the run server and loaded a real run record.
- Event indexes are deduplication identities; they must not be used as Durable Streams offsets.
- Durable Streams offsets are opaque and must be copied from `FlueEventStream.offset`.
- Historical catch-up must not print one line per historical turn or tool call by default.
- `--replay` may opt into historical timeline output.
- Existing secret redaction rules apply to connection errors, live output, JSON output, and exports.
- A stale run and a disconnected watcher are different states and must have different labels.
- The final live totals must equal `audit:export` totals for the same run.
- The watcher must stop after terminal run state, including when metadata becomes terminal before `run_end` reaches the live subscriber.
- The workspace is not currently a Git worktree. Use the test and review checkpoints below instead of commit commands until Git is initialized.

---

## File Map

- Create `scripts/lib/research-run-feed.mjs`: preflight, finite catch-up, opaque checkpoint handling, live subscription, stale reconciliation, and terminal metadata recovery.
- Modify `scripts/research-audit.mjs`: watcher state machine, silent catch-up, concise snapshots, connection labels, and `--replay`.
- Modify `scripts/lib/research-audit-projection.mjs`: correct model and parent-session attribution and terminal elapsed-time data.
- Modify `scripts/lib/session-scope.mjs`: canonical parent/child session resolution if a shared helper is needed.
- Modify `tests/research/run-audit-cli.test.ts`: transport, connection, replay, stale, terminal, and formatting tests.
- Modify `tests/research/run-audit-projection.test.ts`: production-shaped model and session attribution tests.
- Create `tests/fixtures/research/flue-run-events-production-shape.json`: small sanitized fixture using `request.requestedModel`, `session`, and `parentSession` exactly as the observed run did.
- Modify `docs/runbooks/research-audit.md`: operating behavior, states, flags, and recovery guidance.
- Modify `docs/evals/research-audit-baseline.md`: measurable baseline and release gates.

---

### Task 1: Lock the observed failures into production-shaped tests

**Files:**

- Create: `tests/fixtures/research/flue-run-events-production-shape.json`
- Modify: `tests/research/run-audit-projection.test.ts`
- Modify: `tests/research/run-audit-cli.test.ts`

**Interfaces:**

- Consumes: `createAuditProjection`, `formatFooter`, and `watchRun`.
- Produces: failing regression tests for connection state, late attachment, timing, model attribution, and agent attribution.

- [ ] **Step 1: Add a sanitized production-shaped fixture**

Create a compact fixture containing:

```json
[
  {
    "v": 3,
    "eventIndex": 0,
    "timestamp": "2026-07-23T20:29:56.759Z",
    "type": "run_start",
    "runId": "run_production_shape",
    "workflowName": "market-intelligence-scan",
    "startedAt": "2026-07-23T20:29:56.752Z",
    "input": { "runKey": "scan-production-shape" }
  },
  {
    "v": 3,
    "eventIndex": 1,
    "timestamp": "2026-07-23T20:29:56.794Z",
    "type": "log",
    "level": "info",
    "message": "research.audit",
    "attributes": {
      "auditSchemaVersion": "1",
      "auditEvent": "stage_started",
      "auditId": "agent-task:scan-production-shape:discovery:nigeria:1",
      "stageId": "agent-task:scan-production-shape:discovery:nigeria:1",
      "runKey": "scan-production-shape",
      "phase": "discovery",
      "market": "nigeria",
      "agent": "discovery_nigeria",
      "modelRole": "discovery",
      "modelId": "opencode-go/deepseek-v4-flash",
      "sessionName": "discovery:nigeria",
      "status": "started",
      "startedAt": "2026-07-23T20:29:56.794Z"
    }
  },
  {
    "v": 3,
    "eventIndex": 2,
    "timestamp": "2026-07-23T20:30:03.091Z",
    "type": "turn",
    "runId": "run_production_shape",
    "turnId": "turn_1",
    "purpose": "agent",
    "durationMs": 2500,
    "isError": false,
    "session": "task:discovery:nigeria:conversation-id",
    "parentSession": "discovery:nigeria",
    "request": {
      "providerId": "opencode-go",
      "providerName": "opencode-go",
      "requestedModel": "deepseek-v4-flash"
    },
    "response": {
      "usage": {
        "input": 3317,
        "output": 91,
        "cost": { "total": 0.00048986 }
      }
    }
  },
  {
    "v": 3,
    "eventIndex": 3,
    "timestamp": "2026-07-23T20:40:40.026Z",
    "type": "run_end",
    "runId": "run_production_shape",
    "isError": false,
    "durationMs": 643274,
    "result": {
      "runKey": "scan-production-shape",
      "status": "partial",
      "totals": {
        "discovered": 1,
        "accepted": 1,
        "passed": 0,
        "incomplete": 1,
        "rejected": 0
      }
    }
  }
]
```

- [ ] **Step 2: Add failing attribution and elapsed-time tests**

Add assertions:

```ts
expect(report.efficiency.byAgent).toContainEqual(
  expect.objectContaining({ key: 'discovery_nigeria' }),
);
expect(report.efficiency.byMarket).toContainEqual(
  expect.objectContaining({ key: 'nigeria' }),
);
expect(report.efficiency.byModel).toContainEqual(
  expect.objectContaining({ key: 'opencode-go/deepseek-v4-flash' }),
);
expect(report.run.durationMs).toBe(643274);
expect(formatFooter(report, Date.parse('2026-07-24T12:00:00.000Z'), false))
  .toContain('10m 43s');
```

- [ ] **Step 3: Add a failing unreachable-server test**

Use a client whose `runs.get()` rejects:

```ts
const client = {
  runs: {
    get: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3583')),
  },
};

await expect(
  watchRun({ runId: 'run_missing', client, write: (chunk) => writes.push(chunk) }),
).rejects.toThrow(/Unable to connect to the Flue run server/);
expect(writes.join('')).not.toContain('Active:');
```

- [ ] **Step 4: Add a failing late-attachment test**

The mock finite stream must expose an opaque checkpoint:

```ts
const catchup = eventStream(fixtureEvents, 'offset-after-catchup');
const live = eventStream([terminalEvent], 'offset-after-terminal');
client.runs.stream
  .mockReturnValueOnce(catchup)
  .mockReturnValueOnce(live);

await watchRun({ runId, client, write: (chunk) => writes.push(chunk) });

expect(client.runs.stream).toHaveBeenNthCalledWith(
  1,
  runId,
  expect.objectContaining({ live: false }),
);
expect(client.runs.stream).toHaveBeenNthCalledWith(
  2,
  runId,
  expect.objectContaining({ live: true, offset: 'offset-after-catchup' }),
);
expect(writes.filter((line) => line.includes('Catch-up complete'))).toHaveLength(1);
expect(writes.filter((line) => line.includes('TURN'))).toHaveLength(1);
```

- [ ] **Step 5: Run the focused tests and confirm the expected failures**

Run:

```bash
npm test -- tests/research/run-audit-projection.test.ts tests/research/run-audit-cli.test.ts
```

Expected: failures for `requestedModel` attribution, child-session attribution, preflight connection handling, checkpointed live attachment, and terminal elapsed time.

**Review checkpoint:** The tests must reproduce the observed output defects without making network calls.

---

### Task 2: Add a checkpointed run-event feed

**Files:**

- Create: `scripts/lib/research-run-feed.mjs`
- Modify: `tests/research/run-audit-cli.test.ts`

**Interfaces:**

- Consumes: `client.runs.get(runId)`, `client.runs.stream(runId, options)`, and opaque `FlueEventStream.offset`.
- Produces:

```js
createResearchRunFeed({
  client,
  runId,
  signal,
  reconcileAfterMs,
  onState,
})
```

The returned async iterable yields persisted Flue events and exposes the latest run record through `feed.runRecord`.

- [ ] **Step 1: Write tests for preflight, finite catch-up, and live resume**

Require this sequence:

```text
runs.get(runId)
  -> runs.stream(runId, { live: false })
  -> read catch-up to completion
  -> copy catch-up.offset
  -> runs.stream(runId, { live: true, offset: catch-up.offset })
```

Assert that no concrete offset is derived from `eventIndex`.

- [ ] **Step 2: Implement the preflight and catch-up path**

Use this state contract:

```js
export const RUN_FEED_STATES = {
  CONNECTING: 'connecting',
  CATCHING_UP: 'catching-up',
  LIVE: 'live',
  STALE: 'stale',
  DISCONNECTED: 'disconnected',
  TERMINAL: 'terminal',
};
```

The initial metadata request must be outside a retry loop:

```js
let runRecord;
try {
  runRecord = await client.runs.get(runId);
} catch (error) {
  throw new Error(
    `Unable to connect to the Flue run server for ${runId}: ${safeConnectionClass(error)}`,
  );
}
```

Consume the finite stream before opening the live stream:

```js
const catchup = client.runs.stream(runId, { live: false, signal });
for await (const event of catchup) yield event;
const checkpoint = catchup.offset;
```

- [ ] **Step 3: Stop after catch-up when metadata is terminal**

Terminal engine statuses are:

```js
const TERMINAL_RUN_STATUSES = new Set(['completed', 'errored']);
```

If `runRecord.status` is terminal after catch-up, do not open a live subscription.

- [ ] **Step 4: Add stale reconciliation**

When the live consumer has received no persisted event for `reconcileAfterMs`:

1. Call `runs.get(runId)`.
2. If it fails, emit `disconnected`; do not call the run active.
3. If it succeeds and remains active, emit `stale`.
4. If it is terminal, read a finite catch-up stream from the current opaque live checkpoint.
5. Yield any missed events, update the checkpoint from that finite stream, and terminate with the run record.

Do not allow overlapping reconciliation requests.

- [ ] **Step 5: Verify deduplication under catch-up/live overlap**

Feed the same terminal event through reconciliation and the delayed live stream. Assert that the projection counts it once by `(runId, eventIndex)`.

- [ ] **Step 6: Run the feed tests**

Run:

```bash
npm test -- tests/research/run-audit-cli.test.ts
```

Expected: all feed transport tests pass and the projection tests remain at their earlier expected failures until Task 3.

**Review checkpoint:** The feed must recover terminal state without guessing or manufacturing stream offsets.

---

### Task 3: Correct production event attribution and timing

**Files:**

- Modify: `scripts/lib/research-audit-projection.mjs`
- Modify: `scripts/lib/session-scope.mjs`
- Modify: `tests/research/run-audit-projection.test.ts`

**Interfaces:**

- Consumes: production `turn.request.requestedModel`, `turn.session`, and `turn.parentSession`.
- Produces:

```js
resolveTurnModelId(request): string | null
enrichTurnScope(session, parentSession): {
  agent,
  briefId,
  market,
  phase,
  modelRole,
  modelId,
}
```

- [ ] **Step 1: Resolve the actual model request field**

Implement:

```js
function resolveTurnModelId(request) {
  const modelId = request?.requestedModel ?? request?.modelId ?? null;
  if (!modelId) return null;
  const provider = request?.providerId ?? request?.providerName ?? null;
  return provider && !String(modelId).includes('/')
    ? `${provider}/${modelId}`
    : String(modelId);
}
```

Use it in `ingestTurn`.

- [ ] **Step 2: Resolve audit scope through the parent session**

Pass both session values into scope enrichment:

```js
const session = event.session ?? null;
const parentSession = event.parentSession ?? null;
const scope = enrichTurnScope(session, parentSession);
```

Resolve in this order:

1. Exact child session mapping.
2. Exact parent session mapping.
3. Parsed child session.
4. Parsed parent session.

The Nigeria discovery turn must resolve to:

```js
{
  agent: 'discovery_nigeria',
  market: 'nigeria',
  phase: 'discovery',
  modelId: 'opencode-go/deepseek-v4-flash',
}
```

- [ ] **Step 3: Use terminal duration for completed runs**

Update footer duration selection:

```js
const elapsed =
  report.run.durationMs != null
    ? formatDuration(report.run.durationMs)
    : report.run.startedAt
      ? formatDuration(now - Date.parse(report.run.startedAt))
      : 'n/a';
```

- [ ] **Step 4: Run projection tests**

Run:

```bash
npm test -- tests/research/run-audit-projection.test.ts
```

Expected: production-shaped attribution and elapsed-time tests pass.

**Review checkpoint:** No completed run may show time elapsed since the watcher attached or report a known model as `unknown`.

---

### Task 4: Refactor the CLI into an explicit watcher state machine

**Files:**

- Modify: `scripts/research-audit.mjs`
- Modify: `tests/research/run-audit-cli.test.ts`

**Interfaces:**

- Consumes: `createResearchRunFeed` and `createAuditProjection`.
- Produces:

```js
watchRun({
  runId,
  json,
  replay,
  client,
  heartbeatMs,
  staleMs,
  write,
})
```

- [ ] **Step 1: Parse the `--replay` flag**

Extend `parseArgs` so these are boolean flags:

```text
--json
--replay
```

- [ ] **Step 2: Suppress historical line-by-line output by default**

During `catching-up`:

- Ingest every event.
- Render no turn, tool, provider, or stage lines.
- After catch-up, print one summary containing run status, current stage, total tokens, LLM cost, provider cost, provider attempts, and last persisted timestamp.

When `--replay` is present, print the historical timeline once.

- [ ] **Step 3: Render honest connection states**

Required labels:

```text
Connecting: run_...
Catch-up: loading persisted events
Live: review/research_reviewer/opencode-go/grok-4.5
Stale: connected; no persisted event for 1m 5s
Disconnected: run server unreachable; last confirmed event 20:35:11
Completed: partial
Errored: <sanitized error class>
```

Never render `Active` from an empty projection.

- [ ] **Step 4: Make JSON mode emit state transitions**

Use records such as:

```json
{
  "kind": "watcher_state",
  "state": "disconnected",
  "runId": "run_...",
  "lastEventAt": "2026-07-23T20:35:11.460Z",
  "errorClass": "connection_refused"
}
```

Do not include raw exception messages.

- [ ] **Step 5: Exit on metadata-confirmed terminal state**

Finalize with the returned run record:

```js
return projection.finalize(feed.runRecord);
```

The process must exit zero for engine status `completed`, even when the research result is `partial`. It must exit nonzero for connection failure or engine status `errored`.

- [ ] **Step 6: Run CLI tests**

Run:

```bash
npm test -- tests/research/run-audit-cli.test.ts
```

Expected: connection, catch-up, replay, stale, disconnected, and terminal tests pass.

**Review checkpoint:** A user reading only the watcher output must be able to distinguish workflow status, research outcome status, and watcher connection health.

---

### Task 5: Add a local integration test against the Flue run API

**Files:**

- Modify: `tests/research/run-audit-cli.test.ts`
- Modify: `scripts/research-audit.mjs`

**Interfaces:**

- Consumes: a local HTTP fixture implementing `GET /runs/:id?meta` and the Durable Streams event route.
- Produces: an end-to-end watcher regression test that exercises the real SDK client.

- [ ] **Step 1: Start a local fixture server in the test**

The server must provide:

- Active metadata, then completed metadata.
- Historical event catch-up.
- One delayed live event.
- A terminal `run_end`.
- A connection-refused variant by closing the server before `watchRun`.

- [ ] **Step 2: Assert exact terminal totals**

Expected terminal summary:

```text
Completed: partial
LLM $0.0005
Provider $0.0000 known
3,408 tokens
10m 43s
```

- [ ] **Step 3: Assert bounded output**

For a 20,000-event fixture containing 19,900 ignored deltas:

```ts
expect(writes.length).toBeLessThan(100);
expect(writes.join('')).not.toContain('thinking_delta');
```

- [ ] **Step 4: Assert no paid service access**

The integration fixture must fail the test if the watcher requests any URL outside the local fixture origin.

- [ ] **Step 5: Run the integration test**

Run:

```bash
npm test -- tests/research/run-audit-cli.test.ts
```

Expected: the real SDK catch-up and live-resume path passes.

**Review checkpoint:** The test must use the SDK rather than a hand-written fake stream for the final transport check.

---

### Task 6: Document operation and establish release gates

**Files:**

- Modify: `docs/runbooks/research-audit.md`
- Modify: `docs/evals/research-audit-baseline.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: final CLI behavior.
- Produces: operator instructions and measurable release criteria.

- [ ] **Step 1: Document watcher states and commands**

Include:

```bash
npm run audit:watch -- --run-id <runId>
npm run audit:watch -- --run-id <runId> --replay
npm run audit:watch -- --run-id <runId> --json
npm run audit:export -- --run-id <runId>
```

Explain that `completed` is the engine state while `complete`, `partial`, or `failed` is the research result.

- [ ] **Step 2: Add troubleshooting**

Document these exact actions:

```text
Disconnected before first event
  -> confirm npm run dev is listening on FLUE_BASE_URL
  -> confirm RESEARCH_ADMIN_TOKEN matches the dev server
  -> run the watcher again

Stale while connected
  -> inspect current stage and active turn age
  -> do not restart while persisted-event timestamps continue advancing

Completed: partial
  -> inspect review missingItems; this is a research-quality outcome, not a watcher failure
```

- [ ] **Step 3: Record release gates**

The watcher is releasable only when:

- Initial connection failure is visible within 5 seconds.
- A completed 20,000-event run attaches and exits within 3 seconds on the local fixture.
- Default late-attach output remains below 100 lines.
- Live and exported token totals, model cost, provider cost, provider attempt count, stage count, and final outcome match exactly.
- Agent, market, phase, and model attribution contain no `unknown` values when the source events contain those fields.
- Secret-redaction tests pass.
- No paid provider endpoint is called.

- [ ] **Step 4: Run the complete verification suite**

Run separately:

```bash
npm run typecheck
npm test
npm run build
```

Expected:

- TypeScript exits zero.
- All Vitest tests pass.
- Flue Cloudflare build exits zero.

**Review checkpoint:** Run the fixed watcher against one controlled two-market scan and compare its final display with `audit:export` before approving another larger paid run.

---

## Acceptance Criteria

- `audit:watch` never reports an unconfirmed run as active.
- Initial network or authentication failure exits nonzero with a sanitized message.
- Late attachment performs silent historical catch-up and resumes from an opaque stream checkpoint.
- Default output is bounded; `--replay` is explicit.
- A completed run shows its recorded duration, not wall time since attachment.
- Turns inherit agent, phase, brief, and market from the correct parent session.
- `request.requestedModel` is reported as the model ID.
- Stale, disconnected, engine-terminal, and research-outcome states are distinct.
- Terminal live totals match exported totals.
- The watcher adds no LLM or provider cost.

## Plan Self-Review

- Spec coverage: connection truthfulness, historical replay, timing, attribution, stale recovery, terminal recovery, cost safety, tests, and operator documentation are each assigned to a task.
- Placeholder scan: the plan contains no deferred implementation decisions.
- Type consistency: transport uses opaque `FlueEventStream.offset`; projection continues to deduplicate by `eventIndex`.
- Scope boundary: this plan repairs observability only. Research-quality changes belong in a separate pipeline-quality plan.
