import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedMigrations, inspectMigration, runGuard } from './migration-safety-guard.mjs'

const rejected = [
  'DROP\nTABLE public.items;',
  'ALTER TABLE public.items DROP COLUMN name;',
  'ALTER TABLE public.items DROP name;',
  'TRUNCATE public.items;',
  'DELETE\nFROM public.items;',
  'UPDATE public.items\nSET status = 1;',
  'UPDATE public.items SET status = (SELECT id FROM lookup WHERE id = 1);',
  'DELETE FROM public.items USING (SELECT id FROM lookup WHERE id = 1) q;',
  "UPDATE public.items SET name = 'WHERE'; -- WHERE id = 1",
  'DO $$ BEGIN UPDATE public.items SET value = 1; END $$;',
  'WITH changed AS (UPDATE public.items SET value = 1 RETURNING *) SELECT * FROM changed;',
  "DO $body$ BEGIN EXECUTE 'UPDATE public.items SET value = 1'; END $body$;",
  'PREPARE wipe AS DELETE FROM public.items;',
  'ALTER TABLE public.items ADD COLUMN x text, DROP y;',
  "CREATE FUNCTION wipe() RETURNS void LANGUAGE sql AS 'DELETE FROM items';",
]
const allowed = [
  'UPDATE public.items SET value = 1 WHERE id = 2;',
  'DELETE FROM public.items WHERE id = 2;',
  '-- DROP TABLE ignored;\n SELECT 1;',
  '/* DELETE /* nested */ FROM ignored */ SELECT 1;',
  "INSERT INTO audit(note) VALUES ('DROP TABLE test; UPDATE test SET value = 1;');",
  'SELECT * FROM public.items FOR UPDATE;',
  'CREATE TRIGGER t AFTER INSERT OR UPDATE OF status ON items EXECUTE FUNCTION f();',
  'GRANT EXECUTE ON FUNCTION f() TO authenticated;',
  'GRANT SELECT, UPDATE ON items TO authenticated;',
  'ALTER TABLE public.items DROP CONSTRAINT constraint_name;',
  "DO $$ BEGIN UPDATE public.items SET value = 1 WHERE id = 2; END $$;",
  'INSERT INTO items(id) VALUES (1) ON CONFLICT (id) DO UPDATE SET value = 2;',
]
for (const sql of rejected) assert.ok(inspectMigration(sql).length, `must require review: ${sql}`)
for (const sql of allowed) assert.deepEqual(inspectMigration(sql), [], `unexpected rejection: ${sql}`)
assert.throws(() => inspectMigration('/* unclosed'), /Unterminated/)
assert.throws(() => inspectMigration('DO $$ BEGIN'), /Unterminated/)
console.log(`Migration safety guard: ${rejected.length + allowed.length + 2} cases passed`)

const originalDirectory = process.cwd()
const fixture = mkdtempSync(join(tmpdir(), 'migration-guard-'))
try {
  process.chdir(fixture)
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'Local fixture')
  mkdirSync('supabase/migrations', { recursive: true })
  writeFileSync('supabase/migrations/001 original.sql', 'SELECT 1;')
  git('add', '--', 'supabase/migrations/001 original.sql')
  git('-c', 'core.hooksPath=NUL', 'commit', '-m', 'fixture baseline')
  const base = git('rev-parse', 'HEAD')
  writeFileSync('supabase/migrations/001 original.sql', 'UPDATE items SET value = 1;')
  writeFileSync('supabase/migrations/002 added.sql', 'SELECT 2;')
  writeFileSync('unrelated.sql', 'DROP TABLE ignored;')
  git('add', '--', 'supabase/migrations/001 original.sql', 'supabase/migrations/002 added.sql', 'unrelated.sql')
  git('-c', 'core.hooksPath=NUL', 'commit', '-m', 'fixture changes')
  assert.deepEqual(changedMigrations(base).sort(), ['supabase/migrations/001 original.sql', 'supabase/migrations/002 added.sql'])
  assert.throws(() => runGuard(base), /explicit ALLOW-DESTRUCTIVE-MIGRATION/)
  assert.doesNotThrow(() => runGuard(base, 'HEAD', 'Reviewed ALLOW-DESTRUCTIVE-MIGRATION'))
  assert.doesNotThrow(() => runGuard('HEAD'))
} finally {
  process.chdir(originalDirectory)
  rmSync(fixture, { recursive: true, force: true })
}
console.log('Migration guard Git fixture passed: added/modified paths with spaces, unrelated file, override and no-op')
