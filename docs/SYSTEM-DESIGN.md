# Brace Electrical — system design

**Status:** implemented local portfolio prototype, 8 October 2026.  
**Audience:** recruiters, engineering reviewers and prospective accounts-team users.  
**Interactive workflow:** [Open the standalone HTML](diagrams/claim-workflow.html), or visit http://127.0.0.1:8765/workflow while the app is running.

## 1. Business problem and scope

Brace Electrical is a fictional commercial electrical subcontractor in Brisbane. Completed work remains tied up in builder queries about purchase orders, labour hours, missing invoices, variation approvals and claimed payments. Kate Ellis in accounts must connect each query to the right job, reconstruct its evidence and obtain a project lead’s decision.

The design is informed by published industry evidence, not interviews or a claimed customer deployment. The [ASBFEO Procurement Inquiry Report](https://www.asbfeo.gov.au/sites/default/files/2024-08/ASBFEO%20Procurement%20Inquiry%20Report_FINAL%20%281%29.pdf) discusses unpaid variations and subcontractor payment delays. See [design research](../DESIGN-RESEARCH.md) for the product rationale.

The product reduces the effort of assembling a defensible response. It does not adjudicate legal entitlement, calculate statutory deadlines, collect money, or claim to have recovered revenue. All supplied fixtures are synthetic.

## 2. User journey

1. Accounts logs a builder email with an event identifier.
2. The pipeline classifies it and matches a unique invoice within the sender’s account.
3. Deterministic checks compare invoice arithmetic, supporting records and payment status.
4. The claim file shows the discrepancy, source records and proposed next action.
5. Accounts may ask the evidence assistant to explain the issue, identify missing records or prepare a handover.
6. A person approves an eligible reply or refers an unresolved issue to the project lead or finance.
7. Approved replies enter a local test outbox. Closing the query records the outcome without changing invoice payment status.

For INV-1043, 42 billed hours versus 36 signed hours at AUD 150 produces a six-hour / AUD 900 discrepancy. Python calculates this; the model explains it.

## 3. As-built architecture

| Component | Responsibility | Location |
|---|---|---|
| Browser interface | Job register, evidence viewer, review controls, scoped question form | static/app.js, static/style.css |
| HTTP application | Fixed routes, input validation, state transitions and local JSON API | app.py |
| Claim pipeline | Classification, sender/invoice matching, integer-cent checks, template drafts | app.py |
| Evidence assistant | Optional Responses API call, bounded structured output, citation validation | assistant.py |
| SQLite | Invoices, document text, cases, audit events and approved replies | .local/brace.sqlite3 |
| Portable launcher | Loopback binding, demo seeding, temporary demo mode, explicit AI opt-in | run.py |
| Workflow artifact | Self-contained interactive architecture walkthrough | docs/diagrams/claim-workflow.html |

A Python standard-library server and SQLite keep the recruiter setup dependency-free. The browser has no API key. OpenAI calls happen only in the server process. There is no vector database: a small, exact invoice/customer scope makes relational retrieval simpler and more auditable than semantic search.

The HTML diagram presents two independent paths: claim decisions and read-only claim questions. Edges without captions represent direct data handoffs already described by their endpoint names; the approval edge explicitly marks the human gate. Offline briefing bypasses the provider call; exceptions are described in the cards and this document.

## 4. Data model and invariants

| Table | Key / important fields | Invariant |
|---|---|---|
| invoices | id, customer, email, amount, hours, rate, due, paid | Money uses integer cents |
| documents | id, invoice_id, customer, kind, body, hours | Retrieval requires invoice and customer match |
| cases | id, unique event_id, sender, status, category, invoice_id, result, draft, version | Duplicate intake event does not create a second case |
| audit | id, case_id, event, detail, created_at | Local event trail; not tamper-proof |
| outbox | id, unique case_id, recipient, subject, body | At most one approved reply per case |

Project display metadata is a synthetic dictionary in brand.py. Case result snapshots preserve the original processing result. Assistant requests re-read the current ledger and source records rather than trusting browser-submitted context. Assistant answers and questions are kept in browser memory for the session; only an assistant-use audit event persists. A refresh clears answers. Audit events do not retain full model payloads or credentials.

## 5. State machine and concurrency

Intake creates **new**, processing claims it as **processing**, then ends at **review**, **blocked**, or **error**. A retry accepts new/error cases. Eligible review cases become **approved**; review/blocked cases can become **escalated**. Approved/escalated cases can become **resolved**.

SQLite immediate transactions serialize competing state mutations. Approval checks the case version, review eligibility and the current unpaid ledger before inserting the unique outbox row. A second approval is rejected. Restart recovery changes interrupted processing cases to error so they can be retried.

Assistant calls do not increment case versions or change decisions. They capture a version and reject an answer if a claim action changed that version during generation. They release the database connection before the network call. Direct external edits to invoice/document rows do not increment the case version; no such edit API is exposed in this prototype. Production connectors must add a source revision token to the same stale-result check.

## 6. OpenAI integration

AI mode requires **all three**: OPENAI_API_KEY, OPENAI_MODEL and the explicit launcher flag --ai. A configured key alone never enables paid calls.

Classification uses Chat Completions with JSON output and an allowlisted category. The assistant uses the [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses) with store=false and [strict structured output](https://developers.openai.com/api/docs/guides/structured-outputs). Select a model available to your API project that supports both APIs and structured output.

Each assistant request sends:
- The user’s question, bounded to 2,000 characters.
- A freshly matched invoice and its document text.
- The selected builder email, explicitly described as unverified assertions.
- Current deterministic checks, claim status and next action.

Context is capped at 35,000 serialized characters. No other customer’s records or previous conversation is supplied. Requests have a 45-second timeout, a 2,500-token output cap, two concurrent slots and ten starts per minute per server process. Provider retries are manual. These are cost controls, not a billing guarantee; classification calls have a separate 35-second timeout and are outside the assistant limiter. A fresh AI database classifies six seed emails and incurs API use.

The response contains a summary, factual findings with source IDs, suggested next steps and limitations. The server checks field names, types, list lengths, text bounds and every citation against the supplied source allowlist. Refusal, truncation, invalid JSON, invalid citations and provider errors produce an explicit error. No silent AI-to-demo substitution occurs after a failed live call.

**Limits:** source-ID validation proves a source exists in scope, not that it supports the model’s sentence. Hallucinations, incorrect interpretation and prompt injection remain model risks. The UI therefore opens the exact source snapshot for human verification. The model has no tools and no path to approve, send or update payment state.

store=false disables response storage through this API setting; it is not a claim of zero retention across all provider systems. Review the provider’s applicable data controls before using real customer material.

## 7. API contracts

All POST requests require Content-Type: application/json and X-Resolve-Client: local-ui. Browser Origin, when present, must match the local server. Payloads are limited to 50 KB.

| Route | Request / result |
|---|---|
| GET /api/state | Cases, project metadata, outbox, classifier and assistant mode |
| POST /api/ingest | event_id, sender, subject, body → processed workspace snapshot |
| POST /api/seed | Adds missing synthetic demo events idempotently |
| POST /api/cases/:id/ask | question, version → answer, citations, source snapshots, usage, case version |
| POST /api/cases/:id/approve | version, draft → approved local outbox entry |
| POST /api/cases/:id/escalate | version, note → internal referral event |
| POST /api/cases/:id/resolve | version, note → closed query |
| POST /api/cases/:id/retry | Reprocess new/error case |
| GET /workflow | Trusted standalone workflow artifact |

Assistant example:

```json
{"question":"Why do the billed hours need review?","version":1}
```

Validation errors currently use HTTP 400, missing routes 404 and unexpected server failures 500. There is no streaming or multi-turn chat: each question is a fresh evidence-scoped request.

## 8. Trust boundaries and failure handling

The local server binds 127.0.0.1 and is intended for one reviewer on their own machine. It is not an authenticated multi-tenant service. Sender matching is useful demo routing, not proof of sender identity; production needs trusted mailbox ingestion and authenticated tenant scope.

Browser content is escaped before rendering. Fixed static routes prevent arbitrary file serving. The main app uses a restrictive CSP and rejects cross-origin mutation requests. The immutable workflow artifact has a separate inline-script/style CSP, required by its self-contained viewer; network access is disallowed there. API keys stay in process environment and are excluded from Git.

| Failure | Behavior |
|---|---|
| Ambiguous or foreign invoice | Stop; manual matching required |
| Missing PO / variation approval | Block reply automation; refer to a person |
| Payment claimed but ledger unpaid | Refer to finance; never infer payment |
| Provider unavailable / malformed answer | Show explicit retryable error; no claim action |
| Concurrent case action during answer | Discard stale answer |
| App restarted during classification | Recover to error, allow retry |
| Duplicate intake / approval | Unique keys and transactional guards prevent duplicates |

Remaining production gaps include authentication, authorization, encrypted backups, retention/deletion controls, tamper-evident audit, multi-process rate limits, trusted document ingestion, and robust operational monitoring.

## 9. Evaluation and observability

Automated tests cover pipeline decisions, tenant-like sender/document isolation, invoice arithmetic, duplicate events, concurrent approval, HTTP guards, launcher behavior and assistant contracts. Provider tests use mocked responses so the recruiter incurs no cost. They do not establish live model quality.

For a pilot, build a labelled set from approved, redacted customer cases. Measure category precision/recall, unsupported factual statements, citation support, correct abstention, human correction rate, time to a reviewable response, p50/p95 latency and tokens per question. Include malicious instructions in source emails, conflicting payment evidence, stale records and unrelated questions. Require zero unauthorized actions and zero cross-account evidence leakage in the acceptance set. Do not invent production accuracy or savings.

The prototype shows returned token totals in the answer and records assistant use locally. Production should record request IDs, model version, prompt version, latency, token counts and outcome codes without logging raw keys or customer text by default.

## 10. Deployment progression

**Local recruiter demo:** Python 3.10+, no packages, synthetic SQLite fixture, one command. Offline mode is complete enough to evaluate workflow and approval behavior.

**Single-business pilot (proposed):** authenticated web API, managed PostgreSQL, object storage with malware/OCR ingestion, mailbox webhook signature checks, tenant-scoped roles, queued workers, source revision IDs and provider budgets. Replace fixed demo metadata with connector-owned records.

**Production (proposed):** durable jobs with bounded retry/backoff, transactional outbox for approved email delivery, delivery idempotency, reconciliation jobs, tenant authorization on every query, human approval policy, observability, backups and tested recovery. Keep model suggestions outside the ledger write path.

No mailbox, accounting connector, PDF ingestion, real email sending or cloud deployment is implemented here.

## 11. Reviewer walkthrough

Run python run.py --fresh-demo. Open Woolloongabba Medical, inspect the six-hour difference, then use **Ask the file → Explain the discrepancy → Show evidence briefing**. Open CHECKS to inspect its source. Refer the query with a note. Review the PO-backed Newstead claim and approve its reply into the local outbox. Open **Workspace guide → Explore the interactive workflow**.

For live AI, configure credentials locally and restart with --ai. Ask: “Prepare a concise handover for the project manager with facts, open questions and next steps.” Check every cited source. Live provider validation is pending until credentials are supplied locally.
