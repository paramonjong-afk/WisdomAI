# Supabase CLI access — WisdomAI

## Connection metadata

- Project: `WisdomAI`
- Project reference: `xkieyqixlufjqructjkr`
- Organization: `ptmukoyiuqbvlgzjhxjc`
- Region: `ap-south-1` (South Asia / Mumbai)
- CLI token label: `WisdomAI-Codex-CLI`
- Token expiry: `2026-09-23`

## Secret-storage rule

The access-token value is stored only in the Supabase CLI credential store. It must not be copied into this repository, a database table, an application log, `.env`, or a chat message. The project link is kept by the CLI's ignored local metadata.

## Reuse and verification

```powershell
npx supabase projects list
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Expected project status is `ACTIVE_HEALTHY`. A safe baseline check must return `Remote database is up to date` with no migrations, seeds, or roles pending. Do not use `migration repair`, `--include-all`, `db reset`, or `drop` to hide migration drift.

## Rotation and recovery

Create a replacement token before the expiry date, run `npx supabase login`, verify the three commands above, and then revoke the old token in Supabase Account > Access Tokens. If authentication fails, do not print the token; report only the token label, expiry, command, and sanitized error.

## Baseline reconciliation — 2026-08-25

Seven Production migration versions were restored to the repository under their actual applied timestamps. Six earlier local filenames containing the same SQL were removed so that the CLI cannot attempt to apply them again. Verification requires a linked dry-run returning `upToDate: true`; no Production write is required.
