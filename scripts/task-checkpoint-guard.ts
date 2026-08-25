import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

type TaskStatus = 'active' | 'checkpointed' | 'blocked' | 'completed'
type TestStatus = 'pending' | 'passed' | 'failed'

type TaskTest = {
  command: string
  status: TestStatus
  ran_at: string | null
  duration_ms: number | null
  exit_code: number | null
}

type TaskManifest = {
  schema_version: 1
  task_id: string
  title: string
  module: string
  objective: string
  owner_room: string
  branch: string
  base_commit: string
  checkpoint_commit: string | null
  remote: string
  owned_paths: string[]
  status: TaskStatus
  done: string[]
  pending: string[]
  blocker: string | null
  next_action: string
  tests: TaskTest[]
  updated_at: string
  actor: string
}

type CliOptions = Record<string, string[]>

type GitResult = {
  status: number
  stdout: string
  stderr: string
}

const CHECKPOINT_ROOT = '.task-checkpoints'
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const ALLOWED_STATUSES = new Set<TaskStatus>(['active', 'checkpointed', 'blocked', 'completed'])
const PROTECTED_BRANCHES = new Set(['main', 'master'])
const FORBIDDEN_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.codex-worktrees',
  '.deploy-worktrees',
  '.release-worktrees',
])

function now() {
  return new Date().toISOString()
}

function fail(message: string): never {
  throw new Error(message)
}

function parseArgs(args: string[]) {
  const command = args[0] ?? 'help'
  const options: CliOptions = {}
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) fail(`Unexpected argument: ${argument}`)
    const key = argument.slice(2)
    const next = args[index + 1]
    if (!next || next.startsWith('--')) {
      options[key] = [...(options[key] ?? []), 'true']
      continue
    }
    options[key] = [...(options[key] ?? []), next]
    index += 1
  }
  return { command, options }
}

function one(options: CliOptions, key: string, fallback?: string) {
  const values = options[key]
  if (!values?.length) return fallback
  return values.at(-1)
}

function many(options: CliOptions, key: string) {
  return options[key] ?? []
}

function required(options: CliOptions, key: string) {
  const value = one(options, key)
  if (!value?.trim()) fail(`Missing required --${key}`)
  return value.trim()
}

function bool(options: CliOptions, key: string) {
  return one(options, key) === 'true'
}

function git(cwd: string, args: string[], inherit = false): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    windowsHide: true,
  })
  return {
    status: result.status ?? 1,
    stdout: inherit ? '' : String(result.stdout ?? ''),
    stderr: inherit ? '' : String(result.stderr ?? ''),
  }
}

function gitOk(cwd: string, args: string[]) {
  const result = git(cwd, args)
  if (result.status !== 0) fail(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  return result.stdout.trim()
}

function repoRoot(cwd = process.cwd()) {
  return gitOk(cwd, ['rev-parse', '--show-toplevel'])
}

function currentBranch(root: string) {
  const branch = gitOk(root, ['branch', '--show-current'])
  if (!branch) fail('Detached HEAD is not allowed for task checkpoints.')
  return branch
}

function assertWorkBranch(branch: string) {
  if (PROTECTED_BRANCHES.has(branch.toLowerCase())) {
    fail(`Protected branch '${branch}' is not allowed. Use codex/<task> or another dedicated work branch.`)
  }
}

function normalizeOwnedPath(input: string) {
  const value = input.trim().replace(/\\/g, '/')
  if (!value) fail('owned_paths cannot contain an empty path.')
  if (/^[A-Za-z]:\//.test(value) || value.startsWith('/') || value.startsWith('~/')) {
    fail(`Absolute path is not allowed in owned_paths: ${input}`)
  }
  const normalized = value.replace(/^\.\//, '').replace(/\/+/g, '/')
  if (normalized.split('/').some((part) => part === '..')) fail(`Parent traversal is not allowed: ${input}`)
  return normalized.replace(/\/$/, '')
}

function assertSafeOwnedPath(input: string) {
  const path = normalizeOwnedPath(input)
  const matchable = path.endsWith('/**') ? path.slice(0, -3) : path
  const segments = matchable.toLowerCase().split('/').filter(Boolean)
  for (const segment of segments) {
    if (segment === '.env' || segment.startsWith('.env.')) fail(`Environment file is forbidden: ${input}`)
    if (segment.startsWith('.codex')) fail(`Codex runtime path is forbidden: ${input}`)
    if (FORBIDDEN_SEGMENTS.has(segment) || segment.includes('worktree')) fail(`Generated/worktree path is forbidden: ${input}`)
    if (/(^|[._-])(secret|token|password|credential|private[-_]?key|api[-_]?key)([._-]|$)/i.test(segment)) {
      fail(`Secret-like path is forbidden: ${input}`)
    }
  }
  return path
}

function containsSecretLikeValue(value: string) {
  return [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(password|passwd|secret|access[_ -]?token|api[_ -]?key|private[_ -]?key)\s*[:=]\s*\S+/i,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/,
    /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/i,
  ].some((pattern) => pattern.test(value))
}

function assertNoSecrets(label: string, values: string[]) {
  for (const value of values) {
    if (containsSecretLikeValue(value)) fail(`${label} contains secret-like content and cannot be stored.`)
  }
}

function assertSafeTestCommand(command: string) {
  assertNoSecrets('Test command', [command])
  const forbidden = [
    /\bgit\s+(push|merge|rebase|reset|checkout|switch)\b/i,
    /\b(?:wrangler|supabase)\b[^\r\n]*\bdeploy\b/i,
    /\bsupabase\s+(db\s+push|migration\s+(up|repair))\b/i,
    /\bnpm(?:\.cmd)?\s+run\s+deploy(?::|\s|$)/i,
    /\b(rm|rmdir|del)\s+/i,
    /\bRemove-Item\b/i,
    /\b(close|complete)[-_ ]?(financial|advance|settlement|transaction)\b/i,
  ]
  if (forbidden.some((pattern) => pattern.test(command))) {
    fail(`Unsafe test command is not allowed in a checkpoint manifest: ${command}`)
  }
}

function taskDirectory(root: string, taskId: string) {
  return join(root, CHECKPOINT_ROOT, taskId)
}

function manifestPath(root: string, taskId: string) {
  return join(taskDirectory(root, taskId), 'manifest.json')
}

function handoffPath(root: string, taskId: string) {
  return join(taskDirectory(root, taskId), 'handoff.md')
}

function eventPath(root: string, taskId: string) {
  return join(taskDirectory(root, taskId), 'events.jsonl')
}

function saveManifest(root: string, manifest: TaskManifest) {
  assertManifest(manifest)
  mkdirSync(taskDirectory(root, manifest.task_id), { recursive: true })
  writeFileSync(manifestPath(root, manifest.task_id), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

function appendEvent(root: string, manifest: TaskManifest, event: string, details: Record<string, unknown> = {}) {
  assertNoSecrets('Checkpoint event', [event, JSON.stringify(details)])
  mkdirSync(taskDirectory(root, manifest.task_id), { recursive: true })
  const row = { task_id: manifest.task_id, event, at: now(), actor: manifest.actor, details }
  appendFileSync(eventPath(root, manifest.task_id), `${JSON.stringify(row)}\n`, 'utf8')
}

function loadManifest(root: string, taskId: string) {
  const path = manifestPath(root, taskId)
  if (!existsSync(path)) fail(`Task manifest not found: ${relative(root, path)}`)
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as TaskManifest
  assertManifest(manifest)
  return manifest
}

function assertManifest(manifest: TaskManifest) {
  const requiredStrings: Array<keyof TaskManifest> = [
    'task_id', 'title', 'module', 'objective', 'owner_room', 'branch', 'base_commit', 'remote', 'next_action', 'updated_at', 'actor',
  ]
  if (manifest.schema_version !== 1) fail('Unsupported task manifest schema_version.')
  if (!TASK_ID_PATTERN.test(manifest.task_id)) fail(`Invalid task_id: ${manifest.task_id}`)
  for (const key of requiredStrings) {
    if (typeof manifest[key] !== 'string' || !String(manifest[key]).trim()) fail(`Manifest field '${key}' is required.`)
  }
  if (!ALLOWED_STATUSES.has(manifest.status)) fail(`Invalid task status: ${manifest.status}`)
  if (!Array.isArray(manifest.owned_paths) || manifest.owned_paths.length === 0) fail('owned_paths must be an explicit non-empty allowlist.')
  manifest.owned_paths.forEach(assertSafeOwnedPath)
  manifest.tests.forEach((test) => assertSafeTestCommand(test.command))
  const storedText = JSON.stringify({
    title: manifest.title,
    module: manifest.module,
    objective: manifest.objective,
    owner_room: manifest.owner_room,
    done: manifest.done,
    pending: manifest.pending,
    blocker: manifest.blocker,
    next_action: manifest.next_action,
  })
  assertNoSecrets('Manifest', [storedText])
}

function resolveTaskId(root: string, options: CliOptions) {
  const explicit = one(options, 'task-id')
  if (explicit) return explicit
  const checkpointRoot = join(root, CHECKPOINT_ROOT)
  if (!existsSync(checkpointRoot)) fail('Missing --task-id and no task manifests exist.')
  const candidates = readdirSync(checkpointRoot).filter((entry) => existsSync(join(checkpointRoot, entry, 'manifest.json')))
  if (candidates.length !== 1) fail(`Missing --task-id; found ${candidates.length} task manifests.`)
  return candidates[0]
}

function validateBranch(root: string, manifest?: TaskManifest) {
  const branch = currentBranch(root)
  assertWorkBranch(branch)
  if (manifest && branch !== manifest.branch) fail(`Manifest branch '${manifest.branch}' does not match current branch '${branch}'.`)
  return branch
}

function zeroList(value: string) {
  return value.split('\0').filter(Boolean).map((path) => path.replace(/\\/g, '/'))
}

function changedPaths(root: string) {
  const unstaged = zeroList(gitOk(root, ['diff', '--name-only', '-z']))
  const staged = zeroList(gitOk(root, ['diff', '--cached', '--name-only', '-z']))
  const untracked = zeroList(gitOk(root, ['ls-files', '--others', '--exclude-standard', '-z']))
  return {
    all: [...new Set([...unstaged, ...staged, ...untracked])].sort(),
    staged: [...new Set(staged)].sort(),
  }
}

function ownsPath(manifest: TaskManifest, input: string) {
  const path = input.replace(/\\/g, '/')
  return manifest.owned_paths.some((entry) => {
    const normalized = normalizeOwnedPath(entry)
    if (normalized.endsWith('/**')) {
      const prefix = normalized.slice(0, -3).replace(/\/$/, '')
      return path === prefix || path.startsWith(`${prefix}/`)
    }
    return path === normalized || path.startsWith(`${normalized}/`)
  })
}

function partitionChanges(root: string, manifest: TaskManifest) {
  const changes = changedPaths(root)
  const owned = changes.all.filter((path) => ownsPath(manifest, path))
  const unrelated = changes.all.filter((path) => !ownsPath(manifest, path))
  const stagedUnrelated = changes.staged.filter((path) => !ownsPath(manifest, path))
  return { owned, unrelated, stagedUnrelated }
}

function markdownText(value: string) {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim()
}

function bullets(values: string[], empty: string) {
  return values.length ? values.map((value) => `- ${markdownText(value)}`).join('\n') : `- ${empty}`
}

function renderHandoff(root: string, manifest: TaskManifest) {
  const tests = manifest.tests.length
    ? manifest.tests.map((test) => `| \`${markdownText(test.command)}\` | ${test.status} | ${test.ran_at ?? '-'} | ${test.exit_code ?? '-'} |`).join('\n')
    : '| - | not configured | - | - |'
  const content = `# Task Handoff: ${manifest.task_id}

| Field | Value |
| --- | --- |
| Title | ${markdownText(manifest.title)} |
| Module | ${markdownText(manifest.module)} |
| Owner room | ${markdownText(manifest.owner_room)} |
| Status | ${manifest.status} |
| Branch | \`${manifest.branch}\` |
| Base commit | \`${manifest.base_commit}\` |
| Checkpoint commit | \`${manifest.checkpoint_commit ?? 'not-created'}\` |
| Remote | \`${manifest.remote}\` |
| Updated | ${manifest.updated_at} |
| Actor | ${markdownText(manifest.actor)} |

## Objective

${markdownText(manifest.objective)}

## Done

${bullets(manifest.done, 'ยังไม่มีรายการที่บันทึก')}

## Pending

${bullets(manifest.pending, 'ไม่มีรายการค้างที่บันทึก')}

## Blocker

${manifest.blocker ? markdownText(manifest.blocker) : 'none'}

## Next Action

${markdownText(manifest.next_action)}

## Tests

| Command | Result | Ran at | Exit code |
| --- | --- | --- | --- |
${tests}

## Owned Paths

${manifest.owned_paths.map((path) => `- \`${path}\``).join('\n')}

## Resume From Another Account or Worktree

\`\`\`powershell
git fetch ${manifest.remote} ${manifest.branch}
git switch ${manifest.branch} 2>$null; if ($LASTEXITCODE -ne 0) { git switch --track ${manifest.remote}/${manifest.branch} }
npm run checkpoint:resume -- --task-id ${manifest.task_id}
\`\`\`

This record never contains passwords, tokens, private keys, or .env content.
`
  writeFileSync(handoffPath(root, manifest.task_id), content, 'utf8')
}

function actor(options: CliOptions, fallback?: string) {
  return one(options, 'actor', fallback ?? process.env.CODEX_ACTOR ?? process.env.USERNAME ?? process.env.USER ?? 'codex')!
}

function displayChanges(root: string, manifest: TaskManifest) {
  const changes = partitionChanges(root, manifest)
  console.log(`Owned dirty files (${changes.owned.length}):`)
  changes.owned.forEach((path) => console.log(`  OWNED     ${path}`))
  console.log(`Unrelated dirty files (${changes.unrelated.length}, untouched):`)
  changes.unrelated.forEach((path) => console.log(`  UNRELATED ${path}`))
  return changes
}

function commandInit(root: string, options: CliOptions) {
  const branch = validateBranch(root)
  const taskId = required(options, 'task-id')
  if (!TASK_ID_PATTERN.test(taskId)) fail('task_id may contain only letters, numbers, dot, underscore, and dash.')
  if (existsSync(manifestPath(root, taskId))) fail(`Task manifest already exists: ${taskId}`)
  const remote = one(options, 'remote', 'origin')!
  gitOk(root, ['remote', 'get-url', remote])
  const requestedPaths = many(options, 'path')
  if (requestedPaths.length === 0) fail('At least one explicit --path is required.')
  const checkpointPath = `${CHECKPOINT_ROOT}/${taskId}/**`
  const ownedPaths = [...new Set([...requestedPaths.map(assertSafeOwnedPath), checkpointPath])].sort()
  const tests = many(options, 'test').map((command): TaskTest => {
    assertSafeTestCommand(command)
    return { command, status: 'pending', ran_at: null, duration_ms: null, exit_code: null }
  })
  const textFields = [required(options, 'title'), required(options, 'module'), required(options, 'objective'), required(options, 'owner-room')]
  assertNoSecrets('Task metadata', textFields)
  const timestamp = now()
  const manifest: TaskManifest = {
    schema_version: 1,
    task_id: taskId,
    title: textFields[0],
    module: textFields[1],
    objective: textFields[2],
    owner_room: textFields[3],
    branch,
    base_commit: gitOk(root, ['rev-parse', 'HEAD']),
    checkpoint_commit: null,
    remote,
    owned_paths: ownedPaths,
    status: 'active',
    done: many(options, 'done'),
    pending: many(options, 'pending'),
    blocker: null,
    next_action: one(options, 'next-action', 'Inspect the handoff and continue the next pending item.')!,
    tests,
    updated_at: timestamp,
    actor: actor(options),
  }
  saveManifest(root, manifest)
  appendEvent(root, manifest, 'task_initialized', { branch, base_commit: manifest.base_commit })
  renderHandoff(root, manifest)
  console.log(`TASK_INITIALIZED ${taskId}`)
  console.log(`Manifest: ${relative(root, manifestPath(root, taskId))}`)
  console.log(`Next: npm run checkpoint:status -- --task-id ${taskId}`)
}

function commandStatus(root: string, options: CliOptions) {
  const taskId = resolveTaskId(root, options)
  const manifest = loadManifest(root, taskId)
  validateBranch(root, manifest)
  console.log(`Task ${manifest.task_id}: ${manifest.title}`)
  console.log(`Status: ${manifest.status}`)
  console.log(`Branch: ${manifest.branch}`)
  console.log(`Checkpoint: ${manifest.checkpoint_commit ?? 'not-created'}`)
  console.log(`Next action: ${manifest.next_action}`)
  displayChanges(root, manifest)
}

function runDiffCheck(root: string, paths: string[], cached = false) {
  if (paths.length === 0) return
  const args = ['diff', '--check']
  if (cached) args.push('--cached')
  args.push('--', ...paths.map((path) => `:(top,literal)${path}`))
  const result = git(root, args)
  if (result.status !== 0) fail(`git diff --check failed:\n${result.stdout}${result.stderr}`)
}

function commandCheck(root: string, options: CliOptions) {
  const manifest = loadManifest(root, resolveTaskId(root, options))
  validateBranch(root, manifest)
  gitOk(root, ['remote', 'get-url', manifest.remote])
  manifest.tests.forEach((test) => assertSafeTestCommand(test.command))
  const changes = displayChanges(root, manifest)
  if (changes.stagedUnrelated.length) fail(`Unrelated files are already staged: ${changes.stagedUnrelated.join(', ')}`)
  runDiffCheck(root, changes.owned)
  console.log('CHECKPOINT_CHECK_OK')
}

function commandHandoff(root: string, options: CliOptions) {
  const manifest = loadManifest(root, resolveTaskId(root, options))
  validateBranch(root, manifest)
  const nextStatus = one(options, 'status') as TaskStatus | undefined
  if (nextStatus && !ALLOWED_STATUSES.has(nextStatus)) fail(`Invalid --status: ${nextStatus}`)
  const done = many(options, 'done')
  const pending = many(options, 'pending')
  const blocker = one(options, 'blocker')
  const nextAction = one(options, 'next-action')
  assertNoSecrets('Handoff', [...done, ...pending, blocker ?? '', nextAction ?? ''])
  if (bool(options, 'clear-done')) manifest.done = []
  if (bool(options, 'clear-pending')) manifest.pending = []
  if (done.length) manifest.done = [...new Set([...manifest.done, ...done])]
  if (pending.length) manifest.pending = [...new Set([...manifest.pending, ...pending])]
  if (bool(options, 'clear-blocker')) manifest.blocker = null
  if (blocker) manifest.blocker = blocker
  if (nextAction) manifest.next_action = nextAction
  manifest.status = nextStatus ?? (manifest.blocker ? 'blocked' : manifest.status)
  manifest.actor = actor(options, manifest.actor)
  manifest.updated_at = now()
  saveManifest(root, manifest)
  appendEvent(root, manifest, 'handoff_updated', { status: manifest.status, next_action: manifest.next_action })
  renderHandoff(root, manifest)
  console.log(`HANDOFF_UPDATED ${manifest.task_id}`)
  console.log(`Run checkpoint to make it durable: npm run checkpoint:checkpoint -- --task-id ${manifest.task_id}`)
}

function runTests(root: string, manifest: TaskManifest) {
  let failed = false
  for (const test of manifest.tests) {
    console.log(`CHECKPOINT_TEST_START ${test.command}`)
    const started = Date.now()
    const result = spawnSync(test.command, {
      cwd: root,
      shell: true,
      stdio: 'inherit',
      windowsHide: true,
    })
    test.ran_at = now()
    test.duration_ms = Date.now() - started
    test.exit_code = result.status ?? 1
    test.status = test.exit_code === 0 ? 'passed' : 'failed'
    if (test.status === 'failed') failed = true
  }
  return !failed
}

function recordBlocked(root: string, manifest: TaskManifest, blocker: string, event: string) {
  manifest.status = 'blocked'
  manifest.blocker = blocker
  manifest.updated_at = now()
  saveManifest(root, manifest)
  appendEvent(root, manifest, event, { blocker })
  renderHandoff(root, manifest)
}

function stageExactOwnedPaths(root: string, manifest: TaskManifest) {
  const changes = partitionChanges(root, manifest)
  if (changes.stagedUnrelated.length) fail(`Refusing to commit unrelated staged files: ${changes.stagedUnrelated.join(', ')}`)
  if (changes.owned.length === 0) return []
  const result = git(root, ['add', '--', ...changes.owned.map((path) => `:(top,literal)${path}`)])
  if (result.status !== 0) fail(`git add owned_paths failed: ${result.stderr || result.stdout}`)
  return changes.owned
}

function commit(root: string, message: string) {
  const result = git(root, ['commit', '-m', message])
  if (result.status !== 0) fail(`git commit failed: ${result.stderr || result.stdout}`)
  return gitOk(root, ['rev-parse', 'HEAD'])
}

function commandCheckpoint(root: string, options: CliOptions) {
  const manifest = loadManifest(root, resolveTaskId(root, options))
  validateBranch(root, manifest)
  const before = displayChanges(root, manifest)
  if (before.owned.length === 0) {
    console.log(`NO_CHANGES ${manifest.task_id}; no empty checkpoint commit was created.`)
    return
  }
  if (before.stagedUnrelated.length) fail(`Refusing to checkpoint with unrelated staged files: ${before.stagedUnrelated.join(', ')}`)
  if (!runTests(root, manifest)) {
    recordBlocked(root, manifest, 'One or more configured checkpoint tests failed. See the terminal output and tests in manifest.json.', 'checkpoint_test_failed')
    fail(`BLOCKED: configured tests failed. Local handoff: ${relative(root, handoffPath(root, manifest.task_id))}`)
  }
  manifest.status = manifest.status === 'completed' ? 'completed' : 'checkpointed'
  manifest.blocker = null
  manifest.actor = actor(options, manifest.actor)
  manifest.updated_at = now()
  saveManifest(root, manifest)
  appendEvent(root, manifest, 'checkpoint_prepared', { tests: manifest.tests.map((test) => test.status) })
  renderHandoff(root, manifest)

  const prepared = partitionChanges(root, manifest)
  runDiffCheck(root, prepared.owned)
  const staged = stageExactOwnedPaths(root, manifest)
  runDiffCheck(root, staged, true)
  const checkpointCommit = commit(root, `chore(checkpoint): ${manifest.task_id}`)

  manifest.checkpoint_commit = checkpointCommit
  manifest.updated_at = now()
  saveManifest(root, manifest)
  appendEvent(root, manifest, 'checkpoint_committed', { checkpoint_commit: checkpointCommit })
  renderHandoff(root, manifest)
  const metadata = stageExactOwnedPaths(root, manifest)
  runDiffCheck(root, metadata, true)
  commit(root, `chore(checkpoint): ${manifest.task_id} record`)

  if (bool(options, 'no-push')) {
    console.log(`CHECKPOINT_LOCAL_ONLY ${checkpointCommit}`)
    return
  }
  const push = git(root, ['push', '--set-upstream', manifest.remote, manifest.branch], true)
  if (push.status !== 0) {
    recordBlocked(root, manifest, `Push failed for ${manifest.remote}/${manifest.branch}; local commits and handoff remain available.`, 'checkpoint_push_failed')
    fail(`BLOCKED: push failed. Local checkpoint commit: ${checkpointCommit}`)
  }
  console.log(`CHECKPOINT_PUSHED task=${manifest.task_id} branch=${manifest.branch} checkpoint=${checkpointCommit}`)
}

function commandResume(root: string, options: CliOptions) {
  const manifest = loadManifest(root, resolveTaskId(root, options))
  validateBranch(root, manifest)
  if (manifest.checkpoint_commit) gitOk(root, ['cat-file', '-e', `${manifest.checkpoint_commit}^{commit}`])
  console.log(readFileSync(handoffPath(root, manifest.task_id), 'utf8'))
  console.log(`RESUME_READY ${manifest.task_id}`)
  console.log(`Next action: ${manifest.next_action}`)
}

function commandAudit(root: string, options: CliOptions) {
  const taskId = one(options, 'task-id')
  const checkpointRoot = join(root, CHECKPOINT_ROOT)
  if (!existsSync(checkpointRoot)) fail('No task checkpoint directory exists.')
  const taskIds = taskId
    ? [taskId]
    : readdirSync(checkpointRoot).filter((entry) => existsSync(manifestPath(root, entry)))
  if (!taskIds.length) fail('No task manifests found to audit.')
  for (const id of taskIds) {
    const manifest = loadManifest(root, id)
    assertWorkBranch(manifest.branch)
    if (manifest.checkpoint_commit) gitOk(root, ['cat-file', '-e', `${manifest.checkpoint_commit}^{commit}`])
    if (!existsSync(handoffPath(root, id)) || !existsSync(eventPath(root, id))) fail(`Task ${id} is missing handoff or event history.`)
    console.log(`AUDIT_OK ${id} status=${manifest.status} branch=${manifest.branch} checkpoint=${manifest.checkpoint_commit ?? 'none'}`)
  }
}

function printHelp() {
  console.log(`Auto Checkpoint Guard

Commands:
  init        Create a durable task manifest on a non-main work branch
  status      Show manifest state plus owned and unrelated dirty files
  check       Validate branch, allowlist, tests, staging, and diff --check
  handoff     Update done/pending/blocker/next action and render handoff.md
  checkpoint Run tests, commit only owned paths, and push the work branch
  resume      Verify and print handoff for another account/worktree
  audit       Validate one or all durable task records

Use npm run checkpoint:<command> -- [options].`)
}

export function runCli(args = process.argv.slice(2), cwd = process.cwd()) {
  const root = repoRoot(cwd)
  const { command, options } = parseArgs(args)
  switch (command) {
    case 'init': return commandInit(root, options)
    case 'status': return commandStatus(root, options)
    case 'check': return commandCheck(root, options)
    case 'handoff': return commandHandoff(root, options)
    case 'checkpoint': return commandCheckpoint(root, options)
    case 'resume': return commandResume(root, options)
    case 'audit': return commandAudit(root, options)
    case 'help': return printHelp()
    default: fail(`Unknown command: ${command}`)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
