import assert from 'node:assert/strict'
import { connectionTarget, probe } from './probe.mjs'
let connects = 0
let queries = 0
let ends = 0
class FakeClient {
  constructor(config) {
    assert.equal(config.ssl.rejectUnauthorized, true)
    assert.equal(config.options, '-c default_transaction_read_only=on')
    assert.deepEqual(
      { host: config.host, port: config.port, user: config.user, database: config.database },
      connectionTarget,
    )
    assert.equal(config.host, 'aws-1-ap-south-1.pooler.supabase.com')
    assert.equal(config.port, 5432)
    assert.equal(config.user, 'postgres.xkieyqixlufjqructjkr')
    assert.equal(config.password, 'fixture-only')
  }
  on() {}
  async connect() { connects++ }
  async query(sql) { queries++; assert.equal(sql, 'SELECT 1 AS ok'); return { rows: [{ ok: 1 }] } }
  async end() { ends++ }
}
assert.equal(await probe('', FakeClient), 'INVALID_INPUT')
assert.equal(connects, 0)
assert.equal(await probe('fixture-only', FakeClient), 'CONNECTED_READ_ONLY')
assert.equal(connects, 1)
assert.equal(queries, 1)
assert.equal(ends, 1)
for (const [code, expected] of [['28P01', 'PASSWORD_REJECTED_STOP'], ['ENETUNREACH', 'NETWORK_UNREACHABLE'], ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS_CERTIFICATE_BLOCKED'], ['other', 'CONNECTION_FAILED_NOT_PROOF_OF_WRONG_PASSWORD']]) {
  class FailedClient extends FakeClient { async connect() { connects++; throw Object.assign(Error('fixture-only'), { code }) } }
  const before = connects
  assert.equal(await probe('fixture-only', FailedClient), expected)
  assert.equal(connects, before + 1, 'never retry')
}
assert.equal(queries, 1, 'no query after failed connection')
assert.equal(ends, 5, 'always close connection')
console.log('PASS: single attempt, TLS, read-only query, no retry, sanitized failures')
