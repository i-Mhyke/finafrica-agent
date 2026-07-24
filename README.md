# Publication Agent

Flue agent system for publication research automation. Deployed to Cloudflare Workers, separate from the [finafrica](../finafrica/) blog.

All implementation work in this repository is governed by the [Publication Agent Engineering Contract](./AGENTS.md). It defines the content gates, software quality requirements, eval program, and autonomy rules that must pass before publication workflows can carry operational responsibility.

## Stack

- **Framework:** [Flue](https://flueframework.com) (`@flue/runtime`)
- **Target:** Cloudflare Workers + Durable Objects
- **Models:** [OpenCode Go](https://opencode.ai/docs/go/) (OpenAI-compatible subset) + OpenAI
- **Shared specs:** [`../documentation/`](../documentation/)

## Models

Both providers are built into pi-ai — no custom `registerProvider` needed.

| Role | Model | Provider | Env var |
|------|-------|----------|---------|
| `fast` | `opencode-go/deepseek-v4-flash` | OpenCode Go | `OPENCODE_API_KEY` |
| `coding` | `opencode-go/kimi-k2.7-code` | OpenCode Go | `OPENCODE_API_KEY` |
| `default` | `opencode-go/kimi-k2.6` | OpenCode Go | `OPENCODE_API_KEY` |
| `analysis` | `opencode-go/grok-4.5` | OpenCode Go | `OPENCODE_API_KEY` |
| `reasoning` | `opencode-go/kimi-k3` | OpenCode Go | `OPENCODE_API_KEY` |
| `premium` | `openai/gpt-5.2` | OpenAI | `OPENAI_API_KEY` |

Roles are defined in `.flue/models.ts`. Use `model('default')` in agents or override per prompt.

OpenCode Go models **not** included (Anthropic `/v1/messages` endpoint): MiniMax, Qwen3.7.

```ts
import { model, opencodeGo, openai } from '../models.ts';

defineAgent(() => ({ model: model('reasoning') }));
defineAgent(() => ({ model: opencodeGo('glm-5.2') }));
defineAgent(() => ({ model: openai('gpt-4o') }));
```

## Skills

Application-owned Agent Skills copied from the Finafrica project live in `.flue/skills/`:

| Skill | Purpose |
|------|---------|
| `african-financial-intelligence-pipeline` | Source-first research, validation, analysis, review, and publication workflow |
| `emma-finance-article-writer` | Evidence-led African finance article drafting and revision |
| `emdash-cli` | EmDash content, schema, and media operations |
| `building-emdash-site` | EmDash/Astro site development guidance |
| `creating-plugins` | EmDash plugin development guidance |

Each directory follows the Agent Skills layout with a required `SKILL.md` and optional supporting files. The imports are collected in `.flue/skills/index.ts`; register only the skills a given agent needs:

```ts
import { defineAgent } from '@flue/runtime';
import {
	africanFinancialIntelligencePipeline,
	emmaFinanceArticleWriter,
} from '../skills';
import { model } from '../models';

const editorialAgent = defineAgent(() => ({
	model: model('reasoning'),
	skills: [
		africanFinancialIntelligencePipeline,
		emmaFinanceArticleWriter,
	],
}));
```

The current translation workflow does not register these skills because it is scaffold code. Production research, writing, review, and publishing agents should receive separate least-privilege skill and tool sets.

## Dev

```bash
# Local secrets (copy from example)
cp .dev.vars.example .dev.vars

# Start dev server on :3583
npm run dev

# Test the starter workflow
curl http://localhost:3583/workflows/translate?wait=result \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "language": "French"}'
```

## Deploy

```bash
wrangler secret put OPENCODE_API_KEY
wrangler secret put OPENAI_API_KEY
npm run deploy
```

Deploy uses the generated wrangler config at `dist/publication_agent/wrangler.json`, not the source-root `wrangler.jsonc`.

## Project layout

```
.flue/
  workflows/     # HTTP-invokable agent workflows (translate, market-intelligence-scan)
  agents/        # Agent profile definitions (coordinator + research subagents)
  actions/       # Reusable finite operations
  research/      # Schemas, pipeline, audit, prompts
  providers/     # Web research provider adapters
  tools/         # Bounded research tools
  auth/          # Research admin authentication
  skills/        # bundled Agent Skills and supporting references
tests/research/  # Unit and integration tests
docs/            # Architecture, runbooks, eval baselines
wrangler.jsonc   # DO migrations + worker name (source of truth)
flue.config.ts   # Flue target config
```

## Research Pipeline

The `market-intelligence-scan` workflow runs the foundational research pipeline. See:

- [Architecture](docs/architecture/foundational-research-pipeline.md)
- [Runbook](docs/runbooks/research-scan.md)
- [Audit runbook](docs/runbooks/research-audit.md)

```bash
npm run scan -- --input ./scan.json
npm run audit:watch -- --run-id <runId>
npm run audit:watch -- --run-id <runId> --replay
npm run audit:export -- --run-id <runId> --out ./research-runs
npm run test:research
npm run check
```
