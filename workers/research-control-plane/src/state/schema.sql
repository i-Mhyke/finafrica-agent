CREATE TABLE IF NOT EXISTS discovery_runs (
	run_key TEXT NOT NULL,
	workflow_instance_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (run_key)
);

CREATE TABLE IF NOT EXISTS market_checkpoints (
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	revision INTEGER NOT NULL,
	checkpoint_json TEXT NOT NULL,
	terminal_committed INTEGER NOT NULL DEFAULT 0,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase)
);

-- Legacy fan-out tables (provider_receipts, source_records, evidence_records,
-- selected_search_results, discovery_actions, state_transitions) remain for
-- schema compatibility / old runs. New observations store artifacts in
-- provider_observations.payload_json only.
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	action_id TEXT NOT NULL,
	action_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase, action_id)
);

CREATE TABLE IF NOT EXISTS provider_reservations (
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	action_id TEXT NOT NULL,
	reserved_at TEXT NOT NULL,
	status TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase, action_id)
);

CREATE TABLE IF NOT EXISTS provider_observations (
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	action_id TEXT NOT NULL,
	status TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	observed_at TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase, action_id)
);

CREATE TABLE IF NOT EXISTS selected_search_results (
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	source_id TEXT NOT NULL,
	selection_json TEXT NOT NULL,
	search_query TEXT NOT NULL,
	selected_at TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase, source_id)
);

CREATE TABLE IF NOT EXISTS source_records (
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	source_id TEXT NOT NULL,
	source_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase, source_id)
);

CREATE TABLE IF NOT EXISTS evidence_records (
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	evidence_id TEXT NOT NULL,
	evidence_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase, evidence_id)
);

CREATE TABLE IF NOT EXISTS provider_receipts (
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	receipt_id TEXT NOT NULL,
	receipt_json TEXT NOT NULL,
	action_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase, receipt_id)
);

CREATE TABLE IF NOT EXISTS state_transitions (
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	transition_id TEXT NOT NULL,
	transition_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase, transition_id)
);

CREATE TABLE IF NOT EXISTS validation_findings (
	run_key TEXT NOT NULL,
	market TEXT NOT NULL,
	phase TEXT NOT NULL DEFAULT 'discovery',
	finding_id TEXT NOT NULL,
	finding_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (run_key, market, phase, finding_id)
);
