# Master Data Governance & Retention Flow

```mermaid
flowchart LR
  A[Intake / LINE / document / Admin input] --> B[Master-data candidate]
  B --> S[Source Reference Gateway\nCandidate → Transaction → Message]
  S --> S2[Document Flow + Attachment\nEvent + Master Audit]
  S2 --> AI[Auto Input<br/>name/type/account/bank/tax<br/>project/date/owner/route]
  AI --> PG{Project-first Gate}
  PG -->|พบ Project เดิม| PE[Link Existing Project\ncompany-scoped + evidence]
  PG -->|ไม่พบ แต่ข้อมูลขั้นต่ำครบ| PC[Project Candidate\nawaiting_open_project]
  PG -->|ข้อมูลไม่ครบ| PI[Awaiting Information\nowner + reason + next action]
  PE --> C[Rules classification\nMaster + account/tax + project/site + context/history]
  PC --> C
  PI --> E
  C --> D{Policy gate}
  D -->|High confidence + 2 evidence\nno duplicate/conflict| AV[Auto Verified\nnot Final / not Locked]
  D -->|Unknown / duplicate / mismatch / conflict| E[Review Queue]
  AV --> E
  E --> CMD[Drawer Action\none-shot client lock\nawait RPC + require returned Candidate]
  CMD -->|DB commit + refetch matches| V[Append Version + Audit\nreturn Admin Reviewed]
  CMD -->|RPC error / null result / stale refetch| ER[Keep Drawer open\nshow persisted-state error]
  V --> PAC[Persisted Admin classification\ncurrent Drawer value]
  AI -.later AI result is suggestion only.-> PAC
  PAC --> E
  E -->|Confirm bank account| N4[Normalize derived account value\nto final 4 digits]
  N4 -->|valid 4 digits| G[Confirmed Data]
  N4 -->|missing / fewer than 4 digits| ER
  E -->|Confirm non-bank data| G
  E -->|Reject / request info| F[Hold with reason + audit]
  G --> R[Reports: Vendor / Employee-Technician\nCustomer / Company-Internal]
  G --> H[Employee / vendor / customer / project / bank-account reference]
  H --> I[Transactions and workflow routes]
  subgraph UX[Detail Drawer: 3 operational steps]
    U0[1. ความสัมพันธ์<br/>ผูก Project / Project Candidate]
    U0 --> U1[2. ตรวจและแก้ข้อมูล<br/>Auto Input + Admin correction]
    U1 --> U2[3. ยืนยันและส่งต่อ<br/>Refetch queue + next item]
  end
  PG -.controls.-> U0
  PE -.unlocks.-> U1
  PC -.unlocks.-> U1
  V -.evidence.-> U2
  G -.terminal: disable confirm/repeat\nshow next item only.-> U2
  AV -.->|prohibited| X[No payment close / balance cut / Job close]
  G --> J{Unused and no active reference?}
  J -->|Yes| K[Inactive then archive]
  J -->|No| H
  K --> L[Retention audit; restore only by Admin]
```

## Purpose

Create one company-scoped master-data path for people, vendors, customers, projects, work packages and bank-account evidence. New information is first classified from multiple independent evidence sources, becomes reusable only after approval, and is archived rather than deleted when its lifecycle ends.

## Inputs and outputs

- Inputs: extracted name/account facts from transfer evidence, AI/document classification, and authorised Admin entry.
- Outputs: candidate rows, verified aliases and bank accounts, links to the existing person/vendor/customer master, and append-only audit.
- Existing source documents, Intake IDs, transactions and document-flow rows remain canonical; a master candidate stores only a reference to evidence and never duplicates or deletes it.
- Before a candidate can be confirmed or locked, the Project-first Gate must either link one active Project in the same company or save a complete Project Candidate. A Project Candidate is only a request to open a project; it never creates a real `projects` row automatically. Every Gate command uses one `event_key`; replay returns the prior result and a conflicting reuse is rejected, so retries do not append duplicate Audit/Version rows.
- Project matching uses project/customer/site/reference/responsible evidence and the resolved Source Reference. A name by itself is not enough. The Drawer auto-selects an existing Project only when at least two evidence points match; one weak match (for example province only) remains a suggestion for Admin review. Required Project Candidate fields are project name, customer/owner, site/location, responsible person, work type, start date and Source/Document ID. The start date defaults to the earliest related project activity/message/document timestamp and remains editable before save.
- Auto Input derives name, five-type classification, account last four digits, bank, tax ID, Project fields, responsible person, start date, destination Module, owner and next action. Every derived field carries source, confidence and state (`ready`, `review`, `conflict`, `missing`, `persisted`); green can be reused, yellow needs review, red is conflicting, gray is missing and `persisted` identifies a value already saved by Admin. Once an Admin classification is persisted in `admin_reviewed`, `confirmed` or `locked`, it is the current Drawer value; a later AI disagreement is displayed separately as a suggestion and cannot silently replace it. Admin fills only missing/conflicting/material fields. Auto Input never creates a real Project, confirms/locks Master Data, closes a payment or changes Raw/OCR.
- The table and review Drawer consume the same `MasterSourceEvidence` object. For financial candidates, `source_id` is a Transaction ID and must be resolved through `financial_transactions.source_message_id`; it must never be labelled as a Message ID.
- The Source Reference Gateway then joins the Message ID to `document_flow_items`, `line_attachments`, `document_flow_events` and `master_data_audit`. Missing links are shown explicitly as incomplete evidence rather than guessed or replaced with another identifier.
- Classification types are `vendor`, `employee_technician`, `customer`, `company_internal` and `unknown_review`. A name alone is never sufficient: rules require evidence such as an existing Master match, account/tax identity, project/site, message context/history and the resolved Source Reference.
- `auto_verified` is a queue-relief state only. It requires confidence at least 0.95, two independent evidence groups, a resolved source and no conflict/duplicate; it never authorises payment posting, reserve deduction, payroll close or Job close.
- Review queues split pending, duplicate, name/account mismatch, conflict and Unknown/Needs Review. Confirmed reports split Vendor, Employee/Technician, Customer and Company/Internal and retain reviewer/date/source searchability. Queue and report counts are calculated after the same status/type/date and search predicates as the visible rows.

## States, permissions and safeguards

- Data review state: `provisional`, `auto_verified`, `admin_reviewed`, `needs_review`, `confirmed`, `locked`, `rejected`, `archived`. Transaction states remain separate and are not inferred from a master-data review state.
- Master account state: `verified`, `unverified`, `inactive`, `archived`.
- Only a company Admin/Manager may approve, reject, archive, restore or edit a candidate/master account. Direct browser table writes are not allowed.
- Account numbers are stored only as a protected value in the central account registry; standard screens expose bank name, account owner and last four digits. Full account values must not be rendered in ordinary tables.
- Bank-account approval normalizes the derived candidate value before writing `master_bank_accounts.account_last4`: a full or formatted value such as `0856872573` becomes `2573`. Raw message, image, OCR and Source Reference remain unchanged. Fewer than four digits are rejected before any candidate/account/audit state changes, and the Drawer shows the blocking reason without closing.
- Exact normalized matches may create a pending candidate automatically. They do not replace a verified account or enable payment automatically.
- On approval, an account fact is linked to an employee/profile only when exactly one active person has the same normalized name. Unknown or ambiguous names remain a verified-but-unlinked account for Admin resolution; no person is guessed.
- Duplicate candidates are preserved as audit evidence and marked rejected/linked instead of being deleted.
- Admin correction changes derived candidate fields only. Raw/OCR/source evidence is unchanged; each correction appends before/after, actor, timestamp, reason, Source Reference and a candidate version, then returns to review as `admin_reviewed`.
- Project Gate state is stored with the derived candidate snapshot: `received → awaiting_project_classification → linked_existing_project` or `awaiting_new_project`; incomplete evidence becomes `awaiting_information`/`review`, and explicit approval becomes `confirmed`. Only `confirmed`/`approved`/`locked` leaves the pending queue.
- Drawer validation, RPC error and success feedback must be visible inside the active Drawer with the command/event ID. Saving a correction is not confirmation; the UI keeps the row in Review Queue, explains the missing gate/fields, refreshes counts after success and offers the next item. The UI must not display success or close the Drawer until the awaited RPC and a fresh company-scoped read both confirm persistence.
- The Detail Drawer exposes one three-step operational path: `ความสัมพันธ์ → ตรวจและแก้ข้อมูล → ยืนยันและส่งต่อ`. The first step links an existing Project or opens a compact Project Candidate dialog, the second appends Admin correction/Auto Input provenance, and the third confirms only after read-back verification. The current state has one Primary Action; request-information/reject/archive/back/next actions live in the additional-actions menu. A disabled Primary Action lists every missing field or prerequisite inline rather than relying on a snackbar.
- A saved Project Candidate shows its ID, status, actor, timestamp, version and Audit event. A correction shows append-only before/after plus Version/Audit. Terminal confirmation reloads the queue and counts from the same source, removes the confirmed row from `pending_review`, and can open the next pending item. Raw/OCR remains read-only throughout.
- Drawer actions are successful only after the awaited RPC returns the same Candidate and a fresh company-scoped query confirms the expected status/gate/version. A null RPC payload, failed refetch or unchanged status keeps the Drawer open and shows an inline error; no optimistic success or automatic close is allowed.
- A confirmation command is one-shot. The client locks the Candidate synchronously before the request, disables the action while the RPC is in flight, and ignores a second click. After a persisted `confirmed`/`approved`/`locked` status, the confirm action is removed, a `บันทึกแล้ว · ปิดการยืนยันซ้ำ` marker is shown, and the only primary action is `รายการถัดไป`/`กลับคิว`. The existing database review-state guard remains the final protection against a stale or repeated request.
- Summary cards and the default Review Queue use one status projection. `คิวที่ต้องจัดการ = ข้อมูลใหม่ + รอตรวจ/รอข้อมูล + Auto Verified + แก้ไขโดย Admin`; conflicts remain an overlapping quality flag. A `request_info` decision stays in the queue and is labelled as not yet confirmed rather than appearing to complete Master Data.

## Retention, failure and retry

- Candidates with no approved reference can be archived after the configured review period; referenced master records are never hard-deleted automatically.
- A master record is eligible to archive only when inactive and there is no active business reference. Restoring it is an Admin action and creates an audit event.
- Missing company, cross-company reference, an invalid target type, invalid account number, duplicate approval, permission failure, or version conflict is rejected atomically with a recoverable error.
- Owner: Company Admin owns quality and retention; Finance owns verified payment account evidence; HR owns employee identity confirmation; Procurement/Sales own vendor/customer confirmation.

## Change record

| Version | Date | Rationale / impact | Migration | Verification | Rollback |
|---|---|---|---|---|---|
| v2.0 | 25/8/2569 | Prevent rapid double-click/repeated Master Data confirmation and make the terminal state unambiguous; after persistence the confirmation control is removed and only next/back navigation remains | No migration; synchronous client lock plus existing database review-state guard, with no Raw/OCR/candidate/audit mutation | One-shot action regression, Master Data review contracts, lint, typecheck, build and authenticated terminal-Drawer smoke | Revert the client lock/status marker; database status guard and all saved Master Data/Audit remain unchanged |
| v1.9 | 25/8/2569 | Prevent a later evidence-only AI result from displaying `Unknown/Needs Review` over an Admin-saved five-type classification; show the AI result as a separate suggestion with its reason/confidence | No migration or backfill; read projection uses `master-data-auto-input-v2` provenance for future corrections, with no Raw/OCR or current Production data mutation | Persisted-classification regression, targeted lint, typecheck, build and authenticated exact-row Drawer smoke | Revert the Auto Input precedence/display patch; saved candidate classification, Version/Audit and Raw/OCR remain unchanged |
| v1.8 | 25/8/2569 | Reduce the crowded five-state presentation to three operational steps, add compact Project Candidate entry, derive start date and other reusable fields automatically with source/confidence, and prevent silent/non-persisted actions | `20260825220000_master_data_auto_input_three_step.sql` adds Auto Input provenance/date fields and idempotent v2 wrappers; no Raw/OCR mutation | Auto Input/project/step/source/account contracts, local migration checks, targeted/full lint, typecheck, build, responsive Local browser smoke and authenticated Production persistence smoke | Revert UI to v1.7 and call v1 RPCs; revoke v2 wrappers and stop writing new optional metadata columns. Preserve Project Candidate, Version, Audit and all Raw/OCR/source evidence |
| v1.7 | 25/8/2569 | Fix Production confirmation rollback caused by writing a full OCR account number into the four-digit Master Account field; keep the failure visible inside the Drawer | `20260825211200_fix_master_data_account_last4_confirmation.sql`; normalize only the derived Master projection in correction/approval/match RPCs | Regression contract for full/formatted/short values, local RPC migration checks, typecheck/lint/build, rollback-only Production persistence probe and authenticated `/master-data` smoke | Restore the v1.6 correction/review RPC bodies and remove the UI-specific error mapping; do not alter Raw/OCR, existing versions or audit |
| v1.0 | 22/8/2569 | Establish central candidate, verified account, audit and retention foundations without replacing existing employee/vendor/project data | `20260821211435_master_data_governance.sql` | Schema/RLS/RPC, UI, lint/build/test and protected production route | Disable the Master Data UI/RPCs; source records, existing master records and audits remain |
| v1.1 | 22/8/2569 | Link an approved bank candidate to the active employee/technician master only for one exact normalized name match; ambiguous accounts remain safely unlinked | `20260821212940_master_bank_account_person_link.sql` | Function/backfill and RLS/schema verification | Restore previous review function; no source evidence or person record is deleted |
| v1.2 | 24/8/2569 | Correct misleading Message IDs and resolve the complete source chain consistently in both table and Drawer | No migration; read-only gateway over existing source records | Source resolver regression including missing-source case, typecheck/lint/build, `/master-data` Admin smoke | Revert the source gateway/UI mapping; raw source, candidates and audit are unchanged |
| v1.3 | 24/8/2569 | Add five-type classification, Auto Verified policy gate, separated Review Queue/Confirmed Reports and controlled Admin correction without changing raw evidence | `20260824010000_master_data_classification_review.sql` | Five-type fixture, conflict/unknown/duplicate, source parity, audit/version contract, typecheck/lint/build and Cloudflare Admin smoke | Revert UI/classifier and migration functions/triggers; preserve generated audit/version rows and return Auto/Admin Reviewed candidates to `needs_review` |
| v1.4 | 25/8/2569 | Add Project-first Gate so the 53-item Local regression queue can be linked to an existing Project or a complete Project Candidate before confirmation; surface Drawer validation and next-item flow | `20260825105559_master_data_project_first_gate.sql` (applied to Production before revision `0809107`) | 53→52 fixture reconciliation after explicit confirm, existing/new/missing Project cases, append-only audit/version contract, RLS, targeted lint/typecheck/build and authenticated browser smoke | Disable the Gate RPC/trigger and preserve Project Candidate/Audit/Version rows for recovery—never delete Raw/OCR |
| v1.5 | 25/8/2569 | Make the Project-first review path explicit in the Drawer, reduce crowded actions to one state-aware Primary Action, and surface persisted Project/Correction evidence | No schema change; reads existing Project Candidate, Candidate Version and Master Audit records | Step contract, rollback-only RPC persistence probe, 53-item fixture, typecheck/lint/build and Local responsive browser smoke | Revert the Step/receipt UI and loader; existing candidate, Project Candidate, Version, Audit and Raw/OCR rows remain unchanged |
| v1.6 | 25/8/2569 | Fix Production incident where `request_info` persisted but looked unfinished/unchanged, prevent false success on null/stale RPC results, and reconcile the 55-new + 1-follow-up = 56 active queue | No schema change; read-after-write verification over existing RPCs and source tables | Exact Message ID/read-only audit trace, 55+1 projection contract, RPC/refetch guards, rollback-only persistence probe, typecheck/lint/build and authenticated Production smoke | Revert v1.6 UI/projection guards; existing request-info Version/Audit and Raw/OCR remain unchanged |
