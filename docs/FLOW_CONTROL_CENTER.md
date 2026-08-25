# Flow Control Center

Route: `/flow-control-center`

## Canonical source

The page reads `FlowRegistrySnapshot` only. Runtime rows come from the existing tenant-scoped gateway for `omni_intake_sources`, `omni_filter_tasks`, `omni_outtake_delivery_events`, `chat_attendance_approval_jobs`, `chat_attendance_approval_events`, `employee_advance_cases`, `employee_advance_message_deliveries`, and `employee_advance_audit`.

It does not insert, update, close, merge, or generate business tasks or notifications. Problem IDs are deterministic: `problem_type:module:record_id`.

## Flow nodes

`รับเข้า -> AI แยกประเภท -> Master Data ตรวจ -> บัญชี -> HR -> ค่าแรง -> เงินสำรองจ่าย -> ปิดรายการ`

Each node derives `total`, `normal`, `pending`, `problem`, `overdue`, and `actionable` from canonical registry rows. A task may appear in more than one node because nodes represent stages, so reconciliation is performed against canonical rows instead of summing node totals.

## Problem queue

Supported types are `unknown`, `audit_missing`, `duplicate`, `source_missing`, `amount_mismatch`, `name_account_mismatch`, `waiting_approval`, `msg_failed_retry`, and `sla_overdue`.

Each problem preserves Task ID, Source ID, owner, SLA, next action, status, audit references, blocker, and the existing module detail route. URL filters are `from`, `to`, `module`, `status`, `problem`, `source`, and `owner`.

## Local fixture

Use `/flow-control-center?local_test_data=1` in local development. The fixture is isolated from Supabase and contains every node and problem type. The production build cannot enable fixture mode because it is guarded by `import.meta.env.DEV`.
