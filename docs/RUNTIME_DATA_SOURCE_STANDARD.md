# Runtime Data Source Standard

## Single source of truth

- Runtime pages under `src/` read authenticated company data from Supabase gateways/RPCs only.
- Raw/OCR remains immutable evidence. Confirmed/canonical projections are the operational values.
- Browser storage may hold UI preferences, but never business records, approvals, reconciliation, audit, or status.
- Query strings must not activate fixture data or bypass authentication/roles.

## Test data

- Deterministic fixtures live only under `scripts/fixtures/`.
- Tests may import those fixtures directly. Runtime code must never import them.
- `npm run test:runtime-data-source-guard` blocks fixture imports, test-data URL switches, and business-data browser storage from returning to `src/`.

## Safe cleanup

- Do not delete Production Raw/OCR, source documents, audit, versions, or business records.
- Remove only alternate runtime data paths and duplicated development fixtures.
- Add new test scenarios to `scripts/fixtures/`; do not add a fixture mode to an application route.
