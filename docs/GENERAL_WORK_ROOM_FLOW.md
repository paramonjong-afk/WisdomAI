```mermaid
flowchart LR
  A[01 | งานทั่วไป message] --> B[Owner/member + company validation]
  B --> C{Intent}
  C -->|Development| D[program_development_primary]
  C -->|Attendance/HR| E[hr_primary]
  C -->|Finance/advance| F[finance_primary]
  C -->|Other| G[Classified in general room]
  D --> H[System Result + route audit]
  E --> H
  F --> H
  D -.missing room.-> I[pending_destination + retry/audit]
  E -.missing room.-> I
  F -.missing room.-> I
```

# General Work Room

## Purpose

`general_work_primary` is the standard shared room `01 | งานทั่วไป` for ideas, proposals, small tasks, and work whose owner is not yet known. It is not the owner of development, finance, attendance, or HR work.

## Provisioning and permissions

`ensure_standard_general_work_room(company_id)` resolves the canonical key under a company advisory lock, creates the room only when absent, and adds active members from the same company idempotently. The creator is the active company admin; normal room RLS and membership permissions continue to apply. An audit event records room ID, key, creator, time, reason, and company.

## Routing and safety

Messages are classified by explicit development/HR/attendance/finance signals. Development goes to `program_development_primary`; attendance/HR to `hr_primary`; finance/advance to `finance_primary`. A destination is never guessed or replaced by another room. When a target room is missing the route is `pending_destination`, with an audit/error path. Forwarded messages are labelled `System Result`, so they cannot create a development task or business transaction again.

## Change record

- Version: v1.0
- Date: 23/08/2569
- Rationale: add a safe shared triage room requested by the development room.
- Impact: one company-scoped room, route ledger, and read-only audit; no change to business ownership.
- Migration: `20260823035220_general_work_room.sql` (Production baseline).
- Rollback: disable the route trigger, revoke the provisioning RPC, then drop route objects only after retaining audit export.
