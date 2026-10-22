# SHRIII Kiosk Behavioural Games

A research-grade behavioural assessment system for public kiosks in India: short, touch-first,
voice-optional games at a golden-hour village market fair, whose behaviour is turned into **candidate
indicators** for 17 constructs and validated against a standard psychometric criterion battery before
anything is ever reported to a player.

> Treat the system as a scientific measurement instrument first and a game second.

Key documents:

- [`docs/BUILD_DECISIONS.md`](docs/BUILD_DECISIONS.md) — binding decisions for this build iteration.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — scientific source of truth (feature IDs such as `ENG-07`, `SCR-01`).
- [`docs/reference/agent-implementation-spec.md`](docs/reference/agent-implementation-spec.md) — product shape (routes, DB domains, dashboards).
- [`docs/STATUS.md`](docs/STATUS.md) — what is built, what is validated vs research-only, known gaps.

## Live site (Vercel + EC2 + Supabase)

**<https://behavioural-games.vercel.app>** runs `frontend/apps/web` against the production pilot backend.

- `/`: a landing page linking the three areas.
- `/login`: staff sign-in with email or username and password (accounts are issued by an administrator; the
  first sign-in asks for a new password). "Sign in with Google" appears once a Google OAuth client id is
  configured, and works only for existing staff accounts whose username is the Google email.
- `/research` and `/admin`: the research and admin consoles, role- and study-scoped. Their data comes from the
  FastAPI backend on EC2 (`https://52-66-109-32.sslip.io`, [docs/deploy/aws-ec2.md](docs/deploy/aws-ec2.md)),
  reached through a server-side proxy so the browser only talks to the Vercel origin. The database is Supabase
  Postgres in Mumbai on the Pro plan ([docs/deploy/supabase.md](docs/deploy/supabase.md)). The only study data
  there today is synthetic (studies named "SYNTHETIC DEMO ..." and "SYNTHETIC SMOKE TEST").
- `/kiosk`: the kiosk game in the browser, as a public demonstration. It never uploads: the public website is
  not a registered kiosk, so events stay in the browser's local outbox. Research data comes only from
  registered kiosk devices.

Pull-request preview deployments stay self-contained: they build with `NEXT_PUBLIC_DEMO_MODE=1`, use demo
sign-in ("Continue as Researcher (demo)") and an in-app demo API with synthetic fixtures (`src/app/demo-api`),
refuse every write and never reach the production API.

Vercel project `behavioural-games` (scope `cxacraftecosystem-8028s-projects`): Root Directory
`frontend/apps/web`, files outside the root included, Node 24.x. Production env: `NEXT_PUBLIC_DEMO_MODE=0`,
`NEXT_PUBLIC_AUTH_MODE=local`, `API_PROXY_TARGET=https://52-66-109-32.sslip.io`; Preview env:
`NEXT_PUBLIC_DEMO_MODE=1` ([details](docs/deploy/aws-ec2.md#web-app-on-vercel)). Merges to `main` deploy
production (Vercel Git integration). The install and build commands are in `frontend/apps/web/vercel.json`, and
the upload filter is the root `.vercelignore`. To deploy by hand, run `vercel deploy --prod` from the repository
root, not from `frontend/apps/web`. Screenshots are in [`docs/screenshots/deploy`](docs/screenshots/deploy).

## Five data layers (never mixed)

1. **Raw events** — append-only, `contracts/schemas/event-envelope.v1.schema.json`.
2. **Behavioural indicators** — versioned scoring dictionary, `stats/measurement-model/dictionary/*.yaml`.
3. **Criterion scale scores** — versioned keys, `content/instruments/*.yaml`.
4. **Validated trait estimates** — only after the gates in `stats/measurement-model/gates.yaml` pass.
5. **Participant interpretations** — banded, strengths-framed, release-gated (`ReportArtefact`, `ReleasePack`).

Scientific thresholds live only in YAML (`stats/measurement-model/*.yaml`); reports stay disabled until the battery gate
passes in at least two language groups (fail closed).

## Repository layout

Full description, the five data layers mapped to directories and the old-to-new path map:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
frontend/      apps/kiosk (Vite kiosk shell), apps/kiosk-electron (Electron runtime), apps/web (Next.js),
               packages/kiosk-game, outbox-sqlite, session-crypto, escpos-printer, asr-sherpa
backend/api/   FastAPI service, job worker, PostgreSQL 18 schema and Alembic migrations
stats/         Statistical modelling: measurement-model/ (dictionary, hypotheses, gates YAML), scoring/,
               validation/, simulator/, rbridge/, r-psychometrics/ (R), reports/, prereg/
contracts/     Canonical JSON Schemas, generated TS types and validators, fixtures; python/ (Pydantic models)
content/       Game configs, criterion instruments, voice-line catalogue and translations
infra/         compose/ (local and full stack), docker/ (images), tofu/ (OpenTofu)
cicd/          CI gates and helper scripts used by .github/workflows (see cicd/README.md)
tools/         audio-pipeline/, asr-bakeoff/, i18n/, loadtest/
docs/          Plan, build decisions, architecture, governance, security, screenshots
config/        Shared tool config that does not have to sit at the root (tsconfig.base.json)
```

The root holds only files a tool requires there: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
`turbo.json`, `biome.json`, `pyproject.toml`, `uv.lock`, `.gitignore`, `.gitattributes`, `README.md` and
`.github/`. Tool caches go to one gitignored `.cache/` directory; `.venv/` and `node_modules/` stay where the
tools expect them. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#the-repository-root) for why each
root file has to be there.

## Prerequisites

- Node 24 (`engines.node` in `package.json`) and pnpm 12 (`packageManager`; `corepack enable` or a global
  pnpm 12).
- Python 3.13+ (`requires-python`; CI and the images use 3.14) and [uv](https://docs.astral.sh/uv/)
  (`pip install uv`; if `uv` is not on `PATH`, use `python -m uv`). To match CI locally, run
  `uv python pin 3.14` (writes a gitignored `.python-version`) or set `UV_PYTHON=3.14`.
- PostgreSQL 18 for the API and database-backed tests (Docker Desktop via `pnpm db:up`, or any local
  server). The kiosk game, unit tests and bot playthroughs need no database; CI runs the database suites.

## Getting started

```bash
pnpm install                 # JS workspace (frontend/*, contracts)
uv sync --all-packages       # Python workspace -> .venv (backend, stats, contracts/python, tools + dev tools)
cp infra/compose/.env.example .env                  # API/tooling settings (root)
cp infra/compose/.env.example infra/compose/.env    # Docker Compose settings
pnpm db:up                   # PostgreSQL 18 (db shriii, user/password dev) via infra/compose/docker-compose.yml
docker compose -f infra/compose/docker-compose.yml --profile tools up -d   # + Adminer on http://localhost:8080
uv run shriii-api migrate && uv run shriii-api seed --demo   # schema + demo kiosk, instruments, dictionary
```

To just play the game, `pnpm install` then `pnpm --filter @shriii/kiosk dev` is enough (no database).

## Everyday commands

| Task | Command |
|---|---|
| Kiosk dev server | `pnpm --filter @shriii/kiosk dev` (http://localhost:5173; full session, `?module=<id>` for one module) |
| Research/admin web app | `pnpm --filter web dev` (http://localhost:3000) |
| API / worker | `uv run shriii-api serve` (:8000) / `uv run shriii-api worker` |
| Demo pipeline | `uv run shriii-api demo-pipeline --fast` (synthetic sessions -> scoring -> validation) |
| Full-session bot | build with `VITE_E2E_BRIDGE=true`, `vite preview`, then `node frontend/apps/kiosk/e2e/full-session.mjs --url <preview url> --pathway A` |
| All dev servers | `pnpm dev` |
| Build | `pnpm build` (also fails if generated contract code drifted) |
| Type-check | `pnpm typecheck` or `pnpm -r typecheck` |
| JS tests | `pnpm test` |
| Lint / format (JS, JSON) | `pnpm lint` / `pnpm format` (Biome) |
| Python tests | `uv run pytest` (contracts, scoring dictionary, content, member smoke tests) |
| Python lint / types | `uv run ruff check . && uv run ruff format --check . && uv run mypy` |
| Regenerate TS contracts | `pnpm contracts:generate` |
| Regenerate Pydantic models | `uv run python contracts/python/src/shriii_contracts/codegen.py` |

Dev-only switches for the kiosk (`frontend/apps/kiosk/.env`, never honoured by production builds):
`VITE_DEV_VOICE_PLACEHOLDER=true` (Web Speech placeholder with a "DEV VOICE" banner) and
`VITE_DEV_OVERLAY=true` (seed/trial/frame-timing overlay).

## Contracts workflow

1. Edit a schema in `contracts/schemas/` (restricted 2020-12 profile: no `if/then/else`,
   `unevaluated*`, `$dynamicRef`; every `oneOf` needs a `discriminator`).
2. Minor versions add optional fields only; a breaking change needs a new major file plus an upcaster.
3. Run both generators (table above), add or adjust fixtures in `contracts/fixtures/`, then run
   `pnpm test` and `uv run pytest`. Both sides validate the same fixtures (strict writers, tolerant readers).

## Scientific content workflow

- The dictionary, hypotheses and gates are **v0 drafts**. Freezes happen through signed governance records
  (PLT-09); after a freeze, thresholds change only by amendment. `uv run pytest stats/measurement-model` checks schema
  validity, the 17-construct count, matrix rules, cross-references to instruments, hypotheses and voice lines.
- Instrument YAML never contains copyrighted item wording; item text is loaded at administration time
  from the licensed source file referenced by `item_text_source`.
- Game configs carry budget estimates that `uv run pytest content` recomputes against the
  plan section 4.4 session budget (see `content/games/README.md`).
