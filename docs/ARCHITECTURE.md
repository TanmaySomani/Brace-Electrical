# Architecture and tradeoffs

## Components

- `run.py`: portable launcher; offline-by-default mode, local data folder, temporary fresh demo, browser opening and port validation.
- `app.py`: HTTP API, validation, SQLite state transitions, optional OpenAI classification and grounded response assembly.
- `brand.py`: synthetic ledger, documents, emails and job metadata.
- `static/`: UI, source viewer, CSV/EML exports, responsive styles and local fonts.
- `tests/`: pipeline, HTTP concurrency and launcher checks.

## Workflow guarantees and limits

Processing commits its status before classification. HTTP requests wait for processing; this is not a background queue. On restart, interrupted processing becomes a retryable error.

A unique inbound event ID and an immediate SQLite transaction deduplicate concurrent deliveries. Approval uses an immediate transaction, checks the current case version and rechecks the paid flag. A unique outbox case ID prevents repeat approvals from generating another message.

Invoice matching is scoped by sender and invoice ID. Ambiguous matches withhold evidence. Documents must match both invoice and customer. Totals use integer cents. Model classification cannot change the ledger or approve a response. Disputed hours, payment claims and missing variation price approval require human review.

Evidence is snapshotted at processing time. A production integration must also bind approvals to fresh evidence versions; the current demo documents are immutable through the API. A pasted sender is not authentication.

## Stack decision

Python's standard library and SQLite keep setup to one command. Vanilla frontend assets avoid package installs, bundlers and CDN calls. The tradeoff is a local HTTP server, synchronous processing and a single-reviewer workflow. Production needs trusted identity, tenant isolation, a durable queue, source refresh, observability and a production application server.

The LLM interprets language only. Code controls retrieval scope, arithmetic, eligibility and draft content. This does not guarantee perfect classification or the correctness of human-edited replies.

## API

`GET /api/state` returns cases, evidence, jobs, audit entries and approved messages.

Mutations require `Content-Type: application/json` and `X-Resolve-Client: local-ui`. Browser origins must match the loopback server. This is cross-origin mitigation, not authentication.

| Endpoint                        | Body                                            |
| ------------------------------- | ----------------------------------------------- |
| `POST /api/seed`                | `{}`; idempotent demo seed                      |
| `POST /api/ingest`              | `event_id`, `sender`, `subject`, `body` strings |
| `POST /api/cases/{id}/approve`  | current `version`, exact reviewed `draft`       |
| `POST /api/cases/{id}/escalate` | current `version`, reviewer `note`              |
| `POST /api/cases/{id}/resolve`  | current `version`, outcome `note`               |
| `POST /api/cases/{id}/retry`    | `{}`; only new/error cases are processed        |

Unknown static paths are not served. Source files, secrets and the database cannot be downloaded through the static route.

## Optional model

`--ai` enables Chat Completions with the email subject/body treated as untrusted input. The JSON category is checked against an allowlist. Timeouts or invalid responses persist an error state. The optional live call is not covered by offline tests.

[OpenAI API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
