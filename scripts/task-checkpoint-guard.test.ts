import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = resolve('scripts/task-checkpoint-guard.ts')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'wisdom-checkpoint-guard-'))

function run(command: string, args: string[], cwd: string, expected = 0) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\n${output}`)
  return output
}

function git(cwd: string, ...args: string[]) {
  return run('git', args, cwd)
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function createRepository(name: string, options: { branch?: string; validRemote?: boolean } = {}) {
  const repo = join(fixtureRoot, name)
  const remote = join(fixtureRoot, `${name}.git`)
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Checkpoint Contract')
  git(repo, 'config', 'user.email', 'checkpoint@example.invalid')
  write(join(repo, 'README.md'), `${name}\n`)
  git(repo, 'add', '--', 'README.md')
  git(repo, 'commit', '-m', 'initial')
  if (options.validRemote !== false) {
    mkdirSync(remote, { recursive: true })
    git(remote, 'init', '--bare')
  }
  git(repo, 'remote', 'add', 'origin', remote)
  if (options.validRemote !== false) git(repo, 'push', '-u', 'origin', 'main')
  if (options.branch) git(repo, 'switch', '-c', options.branch)
  return { repo, remote }
}

function checkpoint(repo: string, args: string[], expected = 0) {
  return run(process.execPath, ['--experimental-strip-types', cli, ...args], repo, expected)
}

function initTask(repo: string, taskId: string, extra: string[] = [], expected = 0) {
  return checkpoint(repo, [
    'init',
    '--task-id', taskId,
    '--title', 'Contract task',
    '--module', 'platform',
    '--objective', 'Prove durable checkpoints without storing credentials.',
    '--owner-room', 'program-general',
    '--actor', 'contract-test',
    '--path', 'docs\\Project First Notes.md',
    '--next-action', 'Continue from the verified checkpoint.',
    ...extra,
  ], expected)
}

// Main/protected branches must fail before a manifest is written.
{
  const { repo } = createRepository('main-rejection')
  const output = initTask(repo, 'MAIN-REJECT', [], 1)
  assert.match(output, /Protected branch 'main'/)
  assert.equal(existsSync(join(repo, '.task-checkpoints', 'MAIN-REJECT')), false)
}

// Secret paths and Windows absolute paths must be rejected; relative Windows separators and spaces are supported.
{
  const { repo } = createRepository('path-rejection', { branch: 'codex/path-rejection' })
  const common = [
    'init', '--task-id', 'SECRET-PATH', '--title', 'Safe title', '--module', 'platform',
    '--objective', 'Reject unsafe paths.', '--owner-room', 'program-general', '--path', '.env.local',
  ]
  assert.match(checkpoint(repo, common, 1), /Environment file is forbidden/)
  const windowsPath = common.map((value) => value === '.env.local' ? 'C:\\private\\file.txt' : value)
  assert.match(checkpoint(repo, windowsPath, 1), /Absolute path is not allowed/)
}

// Explicit owned paths are committed; unrelated files are shown and untouched. Repeated calls are no-op.
const ownedFixture = createRepository('owned-and-noop', { branch: 'codex/owned-and-noop' })
const resumableRemote = ownedFixture.remote
{
  const { repo } = ownedFixture
  initTask(repo, 'OWNED-NOOP', ['--test', `"${process.execPath}" -e "process.exit(0)"`])
  write(join(repo, 'docs', 'Project First Notes.md'), 'owned checkpoint content\n')
  write(join(repo, 'notes', 'unrelated room.txt'), 'must remain uncommitted\n')
  const output = checkpoint(repo, ['checkpoint', '--task-id', 'OWNED-NOOP'])
  assert.match(output, /UNRELATED notes\/unrelated room.txt/)
  assert.match(output, /CHECKPOINT_PUSHED/)
  assert.match(git(repo, 'status', '--short'), /\?\? notes\//)
  assert.equal(existsSync(join(repo, 'notes', 'unrelated room.txt')), true)
  const branchFiles = git(repo, 'log', '--name-only', '--pretty=format:', 'codex/owned-and-noop')
  assert.match(branchFiles, /docs\/Project First Notes.md/)
  assert.doesNotMatch(branchFiles, /notes\/unrelated room.txt/)
  const manifest = JSON.parse(readFileSync(join(repo, '.task-checkpoints', 'OWNED-NOOP', 'manifest.json'), 'utf8'))
  assert.equal(manifest.status, 'checkpointed')
  assert.match(manifest.checkpoint_commit, /^[0-9a-f]{40}$/)
  assert.ok(manifest.owned_paths.includes('docs/Project First Notes.md'))
  const commitCount = Number(git(repo, 'rev-list', '--count', 'HEAD').trim())
  assert.match(checkpoint(repo, ['checkpoint', '--task-id', 'OWNED-NOOP']), /NO_CHANGES/)
  assert.equal(Number(git(repo, 'rev-list', '--count', 'HEAD').trim()), commitCount)

  // An unrelated staged file must never leak into a checkpoint commit.
  write(join(repo, 'docs', 'Project First Notes.md'), 'second owned change\n')
  git(repo, 'add', '--', 'notes/unrelated room.txt')
  assert.match(checkpoint(repo, ['checkpoint', '--task-id', 'OWNED-NOOP'], 1), /unrelated staged files/i)
  assert.match(git(repo, 'diff', '--cached', '--name-only'), /notes\/unrelated room.txt/)
  git(repo, 'restore', '--staged', '--', 'notes/unrelated room.txt')
  checkpoint(repo, ['checkpoint', '--task-id', 'OWNED-NOOP'])
  checkpoint(repo, ['handoff', '--task-id', 'OWNED-NOOP', '--status', 'completed', '--clear-pending', '--next-action', 'Review the completed checkpoint.'])
  checkpoint(repo, ['checkpoint', '--task-id', 'OWNED-NOOP'])
  const completedManifest = JSON.parse(readFileSync(join(repo, '.task-checkpoints', 'OWNED-NOOP', 'manifest.json'), 'utf8'))
  assert.equal(completedManifest.status, 'completed')
  assert.deepEqual(completedManifest.pending, [])
  assert.match(checkpoint(repo, ['audit', '--task-id', 'OWNED-NOOP']), /AUDIT_OK/)
}

// A failed configured test creates a local blocked handoff and does not create a checkpoint commit.
{
  const { repo } = createRepository('failed-test', { branch: 'codex/failed-test' })
  initTask(repo, 'FAILED-TEST', ['--test', `"${process.execPath}" -e "process.exit(7)"`])
  write(join(repo, 'docs', 'Project First Notes.md'), 'will fail test\n')
  const before = git(repo, 'rev-parse', 'HEAD').trim()
  assert.match(checkpoint(repo, ['checkpoint', '--task-id', 'FAILED-TEST'], 1), /configured tests failed/)
  assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), before)
  const manifest = JSON.parse(readFileSync(join(repo, '.task-checkpoints', 'FAILED-TEST', 'manifest.json'), 'utf8'))
  assert.equal(manifest.status, 'blocked')
  assert.equal(manifest.tests[0].status, 'failed')
  assert.match(readFileSync(join(repo, '.task-checkpoints', 'FAILED-TEST', 'handoff.md'), 'utf8'), /configured checkpoint tests failed/i)
}

// A failed push preserves local commits and appends a blocked handoff instead of force-pushing.
{
  const { repo } = createRepository('failed-push', { branch: 'codex/failed-push', validRemote: false })
  initTask(repo, 'FAILED-PUSH', ['--test', `"${process.execPath}" -e "process.exit(0)"`])
  write(join(repo, 'docs', 'Project First Notes.md'), 'local checkpoint survives push failure\n')
  assert.match(checkpoint(repo, ['checkpoint', '--task-id', 'FAILED-PUSH'], 1), /push failed/i)
  const manifest = JSON.parse(readFileSync(join(repo, '.task-checkpoints', 'FAILED-PUSH', 'manifest.json'), 'utf8'))
  assert.equal(manifest.status, 'blocked')
  assert.match(manifest.checkpoint_commit, /^[0-9a-f]{40}$/)
  assert.match(readFileSync(join(repo, '.task-checkpoints', 'FAILED-PUSH', 'handoff.md'), 'utf8'), /local commits and handoff remain available/i)
}

// A different account/worktree can clone the remote branch and resume without guessing context.
{
  const resumed = join(fixtureRoot, 'resumed-account')
  run('git', ['clone', '--branch', 'codex/owned-and-noop', resumableRemote, resumed], fixtureRoot)
  const output = checkpoint(resumed, ['resume', '--task-id', 'OWNED-NOOP'])
  assert.match(output, /RESUME_READY OWNED-NOOP/)
  assert.match(output, /Review the completed checkpoint/)
  assert.match(output, /docs\/Project First Notes.md/)
}

console.log('auto checkpoint guard contract tests passed')
