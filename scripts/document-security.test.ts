import assert from 'node:assert/strict'
import { inspectDocumentSecurity } from '../supabase/functions/_shared/document-security.ts'

const bytes = (value: string) => new TextEncoder().encode(value)
assert.equal(inspectDocumentSecurity(bytes('%PDF-1.7\n'), 'application/pdf').accepted, true)
assert.equal(inspectDocumentSecurity(bytes('%PDF-1.7\n/JavaScript'), 'application/pdf').reason, 'PDF_ACTIVE_CONTENT_OR_ENCRYPTION')
assert.equal(inspectDocumentSecurity(bytes('%PDF-1.7\n/Java#53cript'), 'application/pdf').reason, 'PDF_ACTIVE_CONTENT_OR_ENCRYPTION')
assert.equal(inspectDocumentSecurity(bytes('%PDF-1.7\n'), 'image/png').reason, 'MIME_SIGNATURE_MISMATCH')
assert.equal(inspectDocumentSecurity(bytes('not a document'), 'application/pdf').reason, 'UNSUPPORTED_OR_INVALID_SIGNATURE')
assert.equal(inspectDocumentSecurity(bytes('RIFF1234WEBP'), 'image/webp').accepted, true)
console.log('document security gate checks passed')
