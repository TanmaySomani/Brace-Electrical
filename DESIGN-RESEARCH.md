# Brace Electrical: business-led redesign

## Domain and concept

Brace Electrical is a fictional commercial electrical subcontractor in Brisbane / South East Queensland. The company, builders, team and jobs are invented for a portfolio demonstration. There has been no customer interview or live business deployment.

The primary user is Kate, who manages accounts and contracts. Site leads know what was installed, when labour was worked, and which builder representative signed a docket. The task is to resolve a builder query without losing the relationship or asserting unsupported payment facts.

## Desk research — 8 October 2026

1. **ASBFEO, Procurement Inquiry Report (2024).** Discusses payment delays from prime contractors to subcontractors, including non-payment for variations and prolonged performance disputes. This supports researching variation evidence as an operational pain point; it does not establish demand for this exact product.
   https://www.asbfeo.gov.au/sites/default/files/2024-08/ASBFEO%20Procurement%20Inquiry%20Report_FINAL%20%281%29.pdf
2. **QBCC, Monies owed complaint.** The official process requests debt evidence including the invoice, contract/agreement and correspondence. It is a specific complaints pathway with eligibility conditions, not a blanket instruction to lodge every disputed invoice. Our application does not lodge complaints or calculate legal deadlines.
   https://www.qbcc.qld.gov.au/ton/node/431
3. **business.gov.au, Prepare a contract.** Encourages documenting variations and providing a way to resolve variation disputes.
   https://business.gov.au/people/contractors/prepare-a-contract/

Research inference: a useful intervention is gathering job-specific evidence and organising the accounts-to-site handover before sending a builder response. Validate frequency, existing tools and willingness to pay through interviews before treating this as a commercial opportunity.

## What changed in the UX

| Workflow issue                                                    | Design response                                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Accounts recognises sites and builders, not arbitrary case IDs    | Job-first register: site, job code and builder on each row                                             |
| Invoice amount alone conceals the dispute                         | Explicit blocker alongside value and days past the stored due date                                     |
| Signed hours differ from billed hours                             | Side-by-side comparison and calculated dollar difference                                               |
| A signed docket can be mistaken for approval of a variation price | Separate site instruction/docket evidence from missing priced variation approval; require human review |
| Supporting records are scattered                                  | Source viewer carrying job, builder, invoice and source reference                                      |
| A generic escalation loses site context                           | Site lead and job code shown above the project-manager referral                                        |
| Finance needs to explain what happened                            | Builder-email and history views adjacent to evidence                                                   |
| Work gets lost when switching tabs                                | Unsaved reply edits and referral notes are retained while navigating within the loaded page            |
| Repeated queries inflate money totals                             | Sum unique invoices for the open-query value                                                           |
| A closed conversation is mistaken for cash recovered              | Explicitly separate query closure from invoice payment state                                           |

## Brand direction

An established trade business, not an AI product launch. A brace-shaped wordmark, warm workpaper surfaces, charcoal type and restrained safety-yellow action colour. Space Grotesk provides the numerals and job headings; Manrope provides the working text. Fonts are hosted locally.

Top navigation replaces the generic application sidebar. Financial summary is a typographic strip rather than four dashboard cards. The job register leads; a nested job-file panel carries evidence and actions. No stock construction photography competes with the task. Motion only supports state changes and action feedback, with reduced-motion support.

## Prototype boundaries

Six synthetic invoices across five jobs. All amounts shown are before tax; no GST, retention, certified progress-payment or statutory entitlement calculation is implemented. The demo ledger date is fixed to 8 October 2026 so overdue-day labels remain interpretable. Text source records are not original signed PDFs. No external email or notification is sent.

The launcher stores local data in `.local/brace.sqlite3`, excluded from Git. `--fresh-demo` creates a separate temporary workspace without modifying saved decisions.

## Validation

Automated pipeline tests cover the existing approval protections and the new missing-variation branch. Browser checks cover source-record reading, job navigation, the updated response workflow and responsive layout. This is implementation verification, not a usability study. A pilot should measure task completion time, time spent finding records, draft edits and mistaken approvals against the old workflow.
