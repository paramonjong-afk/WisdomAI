# Master Data Governance & Retention Flow

```mermaid
flowchart LR
  A[Intake / LINE / document / Admin input] --> B[Master-data candidate]
  B --> S[Source Reference Gateway\nCandidate → Transaction → Message]
  S --> S2[Document Flow + Attachment\nEvent + Master Audit]
  S2 --> PG{Project-first Gate}
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
  E --> CMD[Drawer Action\nawait RPC + require returned Candidate]
  CMD -->|DB commit + refetch matches| V[Append Version + Audit\nreturn Admin Reviewed]
  CMD -->|RPC error / null result / stale refetch| ER[Keep Drawer open\nshow persisted-state error]
  V --> E
  E -->|Confirm| G[Confirmed Data]
  E -->|Reject / request info| F[Hold with reason + audit]
  G --> R[Reports: Vendor / Employee-Technician\nCustomer / Company-Internal]
  G --> H[Employee / vendor / customer / project / bank-account reference]
  H --> I[Transactions and workflow routes]
  subgraph UX[Detail Drawer operational steps]
    U0[Project รอเลือก] --> U1[Project พร้อม]
    U1 --> U2[แก้ข้อมูลแล้ว\nAppend Version + Audit]
    U2 --> U3[รอตรวจซ้ำ]
    U3 --> U4[ยืนยันแล้ว\nRefresh queue + next item]
  end
  PG -.controls.-> U0
  PE -.unlocks.-> U1
  PC -.unlocks.-> U1
  V -.evidence.-> U2
  G -.terminal.-> U4
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
- Project matching uses project/customer/site/reference/responsible evidence and the resolved Source Reference. A name by itself is not enough. The Drawer auto-selects an existing Project only when at least two evidence points match; one weak match (for example province only) remains a suggestion for Admin review. Required Project Candidate fields are project name, customer/owner, site/location, responsible person, work type, approximate start date and Source/Document ID.
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
- Exact normalized matches may create a pending candidate automatically. They do not replace a verified account or enable payment automatically.
- On approval, an account fact is linked to an employee/profile only when exactly one active person has the same normalized name. Unknown or ambiguous names remain a verified-but-unlinked account for Admin resolution; no person is guessed.
- Duplicate candidates are preserved as audit evidence and marked rejected/linked instead of being deleted.
- Admin correction changes derived candidate fields only. Raw/OCR/source evidence is unchanged; each correction appends before/after, actor, timestamp, reason, Source Reference and a candidate version, then returns to review as `admin_reviewed`.
- Project Gate state is stored with the derived candidate snapshot: `received → awaiting_project_classification → linked_existing_project` or `awaiting_new_project`; incomplete evidence becomes `awaiting_information`/`review`, and explicit approval becomes `confirmed`. Only `confirmed`/`approved`/`locked` leaves the pending queue.
- Drawer validation, RPC error and success feedback must be visible inside the active Drawer. Saving a correction is not confirmation; the UI keeps the row in Review Queue, explains the missing gate/fields, refreshes counts after success and offers the next item.
- The Detail Drawer exposes one five-step operational path: `Project รอเลือก → Project พร้อม → แก้ข้อมูลแล้ว → รอตรวจซ้ำ → ยืนยันแล้ว`. Project actions are mutually exclusive, the current state has one Primary Action, and request-information/reject/archive/back/next actions live in the additional-actions menu. A disabled Primary Action lists every missing field or prerequisite inline rather than relying on a snackbar.
- A saved Project Candidate shows its ID, status, actor, timestamp, version and Audit event. A correction shows append-only before/after plus Version/Audit. Terminal confirmation reloads the queue and counts from the same source, removes the confirmed row from `pending_review`, and can open the next pending item. Raw/OCR remains read-only throughout.
- Drawer actions are successful only after the awaited RPC returns the same Candidate and a fresh company-scoped query confirms the expected status/gate/version. A null RPC payload, failed refetch or unchanged status keeps the Drawer open and shows an inline error; no optimistic success or automatic close is allowed.
- Summary cards and the default Review Queue use one status projection. `คิวที่ต้องจัดการ = ข้อมูลใหม่ + รอตรวจ/รอข้อมูล + Auto Verified + แก้ไขโดย Admin`; conflicts remain an overlapping quality flag. A `request_info` decision stays in the queue and is labelled as not yet confirmed rather than appearing to complete Master Data.

## Retention, failure and retry

- Candidates with no approved reference can be archived after the configured review period; referenced master records are never hard-deleted automatically.
- A master record is eligible to archive only when inactive and there is no active business reference. Restoring it is an Admin action and creates an audit event.
- Missing company, cross-company reference, an invalid target type, invalid account number, duplicate approval, permission failure, or version conflict is rejected atomically with a recoverable error.
- Owner: Company Admin owns quality and retention; Finance owns verified payment account evidence; HR owns employee identity confirmation; Procurement/Sales own vendor/customer confirmation.

## Change record

| Version | Date | Rationale / impact | Migration | Verification | Rollback |
|---|---|---|---|---|---|
| v1.0 | 22/8/2569 | Establish central candidate, verified account, audit and retention foundations without replacing existing employee/vendor/project data | `20260821211435_master_data_governance.sql` | Schema/RLS/RPC, UI, lint/build/test and protected production route | Disable the Master Data UI/RPCs; source records, existing master records and audits remain |
| v1.1 | 22/8/2569 | Link an approved bank candidate to the active employee/technician master only for one exact normalized name match; ambiguous accounts remain safely unlinked | `20260821212940_master_bank_account_person_link.sql` | Function/backfill and RLS/schema verification | Restore previous review function; no source evidence or person record is deleted |
| v1.2 | 24/8/2569 | Correct misleading Message IDs and resolve the complete source chain consistently in both table and Drawer | No migration; read-only gateway over existing source records | Source resolver regression including missing-source case, typecheck/lint/build, `/master-data` Admin smoke | Revert the source gateway/UI mapping; raw source, candidates and audit are unchanged |
| v1.3 | 24/8/2569 | Add five-type classification, Auto Verified policy gate, separated Review Queue/Confirmed Reports and controlled Admin correction without changing raw evidence | `20260824010000_master_data_classification_review.sql` | Five-type fixture, conflict/unknown/duplicate, source parity, audit/version contract, typecheck/lint/build and Cloudflare Admin smoke | Revert UI/classifier and migration functions/triggers; preserve generated audit/version rows and return Auto/Admin Reviewed candidates to `needs_review` |
| v1.4 | 25/8/2569 | Add Project-first Gate so the 53-item Local regression queue can be linked to an existing Project or a complete Project Candidate before confirmation; surface Drawer validation and next-item flow | `20260825105559_master_data_project_first_gate.sql` (applied to Production before revision `0809107`) | 53→52 fixture reconciliation after explicit confirm, existing/new/missing Project cases, append-only audit/version contract, RLS, targeted lint/typecheck/build and authenticated browser smoke | Disable the Gate RPC/trigger and preserve Project Candidate/Audit/Version rows for recovery—never delete Raw/OCR |
| v1.5 | 25/8/2569 | Make the Project-first review path explicit in the Drawer, reduce crowded actions to one state-aware Primary Action, and surface persisted Project/Correction evidence | No schema change; reads existing Project Candidate, Candidate Version and Master Audit records | Step contract, rollback-only RPC persistence probe, 53-item fixture, typecheck/lint/build and Local responsive browser smoke | Revert the Step/receipt UI and loader; existing candidate, Project Candidate, Version, Audit and Raw/OCR rows remain unchanged |
| v1.6 | 25/8/2569 | Fix Production incident where `request_info` persisted but looked unfinished/unchanged, prevent false success on null/stale RPC results, and reconcile the 55-new + 1-follow-up = 56 active queue | No schema change; read-after-write verification over existing RPCs and source tables | Exact Message ID/read-only audit trace, 55+1 projection contract, RPC/refetch guards, rollback-only persistence probe, typecheck/lint/build and authenticated Production smoke | Revert v1.6 UI/projection guards; existing request-info Version/Audit and Raw/OCR remain unchanged |
