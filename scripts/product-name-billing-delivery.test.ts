import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql=readFileSync('supabase/migrations/202608160010_product_name_and_billing_delivery_links.sql','utf8')
const ui=readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
for(const pattern of [/save_accounting_product_name/,/manual_product_name_correction/,/inventory_name_updated/,/billing_delivery_note_links/,/confirm_billing_note_delivery_notes/,/unique\(delivery_note_document_id\)/,/delivery_note_vendor_mismatch/])assert.match(sql,pattern)
for(const pattern of [/saveProductName/,/จับคู่ใบส่งของ\/ใบรับสินค้ากับใบวางบิล/,/selectedDeliveryNoteIds/,/confirmBillingDeliveryNotes/])assert.match(ui,pattern)
console.log('product name and billing delivery checks passed')
