# Verification and pilot plan

## Verified scope

Automated tests exercise deterministic controls and the real local HTTP interface: concurrent duplicate intake, concurrent approval, missing variation approval, changed paid state, stale versions, scoped evidence, failure/retry and restart persistence. Databases are temporary; no provider is called.

Manual browser checks cover desktop and 390px mobile layouts, job navigation, source records, approval to the local outbox and missing-variation review. Mobile content fits the viewport. These checks are not a formal accessibility audit or usability study.

## What is not claimed

No measured production ROI, time saving, collection uplift or general model accuracy. No customer deployment, endorsement or actual project data. No live accounting or delivery adapters. No verified legal deadlines, GST, retentions or payment entitlements. No proof that arbitrary adversarial text is always classified correctly.

## Design-partner pilot

1. Interview accounts staff and project managers at three electrical subcontractors. Walk through their last five invoice blockers.
2. Measure handling time and where evidence lives. Check which existing tools already solve it.
3. Collect permissioned, anonymised examples with labels for invoice, category, source IDs and next action. Keep a held-out split.
4. Compare rules, model classification and manual handling on the same examples.
5. Measure matching accuracy, per-category precision/recall, unsupported claims, draft edits, median handling time, duplicate actions and model cost.
6. Run read-only/shadow mode before enabling approved external delivery.

## Production work

Trusted mailbox ingestion, tenant authentication and roles; accounting/job-management connectors; PDF extraction and approval provenance; immutable evidence versions; durable workers and monitoring; real email delivery with exact-content approval, reconciliation and idempotency; ownership, follow-ups and notifications; retention, backups, accessibility testing and security review.

## Evidence assistant extension

The suite now includes provider-contract mocks, unknown citation rejection, incomplete output handling, secret-safe provider errors, live-ledger rereads, stale request rejection, scoped context, offline no-network behavior and HTTP route checks. These validate code boundaries; they do not measure live model accuracy. See SYSTEM-DESIGN.md for the proposed pilot evaluation.
