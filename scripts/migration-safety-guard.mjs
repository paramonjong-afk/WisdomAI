import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Conservative lexical guard, not a proof that SQL is safe. Ignore comments
// and quoted values, inspect dollar-quoted bodies, and reject dynamic EXECUTE.
export function sqlTokens(sql) {
  const tokens = []
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i])) { i++; continue }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i)
      i = end < 0 ? sql.length : end + 1
      continue
    }
    if (sql.startsWith('/*', i)) {
      let depth = 1
      i += 2
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2 }
        else if (sql.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      if (depth) throw new Error('Unterminated SQL comment')
      continue
    }
    const delimiter = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0]
    if (delimiter) {
      const end = sql.indexOf(delimiter, i + delimiter.length)
      if (end < 0) throw new Error('Unterminated SQL body')
      tokens.push(';', ...sqlTokens(sql.slice(i + delimiter.length, end)), ';')
      i = end + delimiter.length
      continue
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++]
      let closed = false
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue }
          i++; closed = true; break
        }
        // Treat backslash quoting conservatively for E strings.
        if (sql[i] === '\\' && quote === "'") i++
        i++
      }
      if (!closed) throw new Error('Unterminated SQL quote')
      tokens.push(quote === '"' ? 'IDENTIFIER' : 'LITERAL')
      continue
    }
    const word = sql.slice(i).match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0]
    if (word) { tokens.push(word.toUpperCase()); i += word.length }
    else tokens.push(sql[i++])
  }
  return tokens
}

export function inspectMigration(sql) {
  const tokens = sqlTokens(sql)
  const issues = new Set()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === 'AS' && tokens[i + 1] === 'LITERAL') {
      const start = tokens.lastIndexOf(';', i) + 1
      if (tokens.slice(start, i).some(word => ['FUNCTION', 'PROCEDURE'].includes(word))) {
        issues.add('single-quoted routine body requires review')
      }
    }
    if (token === 'TRUNCATE') issues.add('TRUNCATE')
    if (token === 'DROP') {
      if (tokens[i + 1] === 'TABLE') issues.add('DROP TABLE')
      if (tokens[i + 1] === 'COLUMN') issues.add('DROP COLUMN')
      const start = tokens.lastIndexOf(';', i) + 1
      if (tokens.slice(start, i).includes('ALTER') && tokens.slice(start, i).includes('TABLE')
        && !['CONSTRAINT', 'DEFAULT', 'NOT', 'IDENTITY', 'EXPRESSION'].includes(tokens[i + 1])) {
        issues.add('ALTER TABLE DROP')
      }
    }
    if (token === 'EXECUTE' && !['FUNCTION', 'PROCEDURE', 'ON'].includes(tokens[i + 1])
      && !['GRANT', 'REVOKE'].includes(tokens[i - 1])) issues.add('dynamic EXECUTE requires review')
    const isDelete = token === 'DELETE' && tokens[i + 1] === 'FROM'
    // ON CONFLICT DO UPDATE SET is limited by the conflict key; trigger and
    // privilege declarations and FOR UPDATE locks are not UPDATE statements.
    const isUpdate = token === 'UPDATE' && !['OF', 'ON', 'OR', 'TO', 'SET', ',', ';'].includes(tokens[i + 1])
    if (!isDelete && !isUpdate) continue
    let depth = 0
    let hasWhere = false
    let hasSet = false
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j] === ';' || (tokens[j] === ')' && depth === 0)) break
      if (tokens[j] === '(') depth++
      else if (tokens[j] === ')') depth--
      else if (depth === 0 && tokens[j] === 'WHERE') hasWhere = true
      else if (depth === 0 && tokens[j] === 'SET') hasSet = true
    }
    if (!hasWhere && (isDelete || hasSet)) issues.add(`${token} without top-level WHERE`)
  }
  return [...issues]
}

export function changedMigrations(base, head = 'HEAD') {
  return execFileSync('git', ['diff', '--name-only', '-z', '--diff-filter=AM', base, head, '--', 'supabase/migrations'], { encoding: 'utf8' })
    .split('\0').filter(path => path.endsWith('.sql'))
}

export function runGuard(base, head = 'HEAD', message = '') {
  const findings = changedMigrations(base, head).flatMap(path =>
    inspectMigration(readFileSync(path, 'utf8')).map(issue => ({ path, issue })))
  for (const finding of findings) console.log(`${finding.path}: ${finding.issue}`)
  const override = /\bALLOW-DESTRUCTIVE-MIGRATION\b/.test(message)
  if (findings.length && !override) throw new Error('Migration requires explicit ALLOW-DESTRUCTIVE-MIGRATION review')
  console.log(findings.length ? 'Explicit destructive migration override present; review findings above.' : 'Migration SQL guard passed.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2]
  if (!base) throw new Error('Explicit comparison base is required')
  runGuard(base, process.argv[3] ?? 'HEAD', process.env.COMMIT_MSG ?? '')
}
