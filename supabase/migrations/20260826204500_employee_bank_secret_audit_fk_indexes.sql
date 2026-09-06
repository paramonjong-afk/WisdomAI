-- Cover audit-actor foreign keys in the private employee bank secret store.
-- These indexes avoid full scans when a profile deletion/update checks FK references.

create index if not exists employee_bank_account_secrets_created_by_idx
  on private.employee_bank_account_secrets(created_by)
  where created_by is not null;

create index if not exists employee_bank_account_secrets_updated_by_idx
  on private.employee_bank_account_secrets(updated_by)
  where updated_by is not null;

-- Rollback/recovery: these indexes are non-destructive and may be dropped
-- concurrently if they cause an unexpected planner regression; retain all data.
