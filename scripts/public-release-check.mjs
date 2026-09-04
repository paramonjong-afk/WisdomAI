import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const publicBase = '855f6d4e8416ed2a26a8ba9bb98012293f5f6214'
const privateSnapshotBlob = '6ddc1d5b4d22323950563f51a4e7475a6c468d72'

export function checkPublicRelease({ cwd = process.cwd(), base = publicBase, head = 'HEAD', blockedBlobs = [privateSnapshotBlob] } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  // Resolve refs first, then pass only hashes to revision-range commands.
  const baseSha = git('rev-parse', '--verify', `${base}^{commit}`)
  const headSha = git('rev-parse', '--verify', `${head}^{commit}`)
  git('merge-base', '--is-ancestor', baseSha, headSha)
  const commits = git('rev-list', `${baseSha}..${headSha}`).split('\n').filter(Boolean)
  let checkedFiles = 0
  for (const commit of commits) {
    const tree = git('ls-tree', '-r', '-z', commit)
    for (const entry of tree.split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t')
      const [, type, sha] = entry.slice(0, tab).split(' ')
      const path = entry.slice(tab + 1).replaceAll('\\', '/')
      if (type !== 'blob') continue
      checkedFiles++
      if (blockedBlobs.includes(sha) || /^docs\/recovery\//i.test(path) || /\.review\.json$/i.test(path)) {
        throw new Error('Public release blocked: recovered SQL snapshot in outgoing history')
      }
    }
  }
  return { commits: commits.length, checkedFiles, recoveredSnapshotFound: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(checkPublicRelease()))
  } catch {
    console.error('Public release blocked: inspect outgoing history locally; do not push')
    process.exitCode = 1
  }
}
