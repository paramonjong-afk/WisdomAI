import { pathToFileURL } from 'node:url'
import { Client } from 'pg'

export async function probe(password, ClientClass = Client) {
  if (typeof password !== 'string' || !password || password.length > 1024) return 'INVALID_INPUT'
  const client = new ClientClass({
    host: 'db.xkieyqixlufjqructjkr.supabase.co', port: 5432,
    user: 'postgres', database: 'postgres', password,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 8000, query_timeout: 4000, statement_timeout: 4000,
    options: '-c default_transaction_read_only=on',
    application_name: 'wisdomai-one-attempt-password-probe',
  })
  client.on('error', () => {})
  try {
    await client.connect()
    const result = await client.query('SELECT 1 AS ok')
    return result.rows?.[0]?.ok === 1 ? 'CONNECTED_READ_ONLY' : 'UNEXPECTED_RESPONSE'
  } catch (error) {
    if (error.code === '28P01') return 'PASSWORD_REJECTED_STOP'
    if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code)) return 'TLS_CERTIFICATE_BLOCKED'
    if (['ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error.code)) return 'NETWORK_UNREACHABLE'
    return 'CONNECTION_FAILED_NOT_PROOF_OF_WRONG_PASSWORD'
  } finally {
    await client.end().catch(() => {})
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Never accept credentials from argv, environment or a browser/server.
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    input += chunk
    if (input.length > 8192) { process.stdout.write('INVALID_INPUT'); process.exit(1) }
  }
  try {
    const payload = JSON.parse(input)
    input = ''
    const result = await probe(payload.password)
    payload.password = ''
    process.stdout.write(result)
  } catch {
    process.stdout.write('LOCAL_PROBE_FAILED')
    process.exitCode = 1
  }
}
