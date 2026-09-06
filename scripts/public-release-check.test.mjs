import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPublicRelease } from './public-release-check.mjs'

// Synthetic fixtures only; never read or copy the real private snapshot.
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'public-release-fixture-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  const commit = (path, content) => {
    mkdirSync(join(cwd, path, '..'), { recursive: true })
    writeFileSync(join(cwd, path), content)
    git('add', '--', path)
    git('commit', '-qm', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const base = commit('README.md', 'synthetic baseline\n')
  return { cwd, git, commit, base }
}
const clean = fixture()
assert.equal(checkPublicRelease(clean).commits, 0)
clean.commit('safe file.txt', 'synthetic safe code\n')
assert.equal(checkPublicRelease(clean).commits, 1)

const hidden = fixture()
hidden.commit('docs/recovery/sample.review.json', '{"synthetic":true}\n')
assert.throws(() => checkPublicRelease(hidden))
hidden.git('rm', '--', 'docs/recovery/sample.review.json')
hidden.git('commit', '-qm', 'remove fixture')
assert.throws(() => checkPublicRelease(hidden), 'deleting the file must not erase history risk')

const renamed = fixture()
renamed.commit('innocent name.txt', 'synthetic private bytes\n')
const blob = renamed.git('rev-parse', 'HEAD:innocent name.txt')
assert.throws(() => checkPublicRelease({ ...renamed, blockedBlobs: [blob] }))
assert.throws(() => checkPublicRelease({ ...clean, base: 'missing-reference' }))
assert.throws(() => checkPublicRelease({ ...clean, base: 'HEAD', head: clean.base }))
console.log('Public release guard passed: safe/no-op, deleted history, renamed blob and invalid ancestry')
