import type { TransferSlipQueueRow } from './accountingTransferSlipQueue'

export type TransferSlipTruthStatus = 'needs_review' | 'needs_information' | 'confirmed' | 'duplicate'

export type TransferSlipOperationalTruthRow = {
  task_id: string
  task_status: string
  task_created_at: string
  item_id: string
  intake_id: string | null
  source_message_id: string | null
  current_room: string | null
  route_target: string | null
  source_channel: string | null
  source_room_name: string | null
  source_sender_name: string | null
  source_received_at: string | null
  data_review_status: string | null
  data_review_note: string | null
  candidate_departments: string[] | null
  transaction_id: string | null
  review_status: string | null
  duplicate_of: string | null
  expense_type: string | null
  labor_amount: number | null
  payment_party_confidence: number | null
  analysis_confidence: number | null
  analysis_model: string | null
  notes: string | null
  evidence_sender_name: string | null
  evidence_sender_bank_name: string | null
  evidence_sender_account_last4: string | null
  evidence_recipient_name: string | null
  evidence_recipient_bank_name: string | null
  evidence_recipient_account_last4: string | null
  evidence_amount: number | null
  evidence_transfer_at: string | null
  evidence_bank_reference: string | null
  truth_status: TransferSlipTruthStatus
  is_postable: boolean
  canonical_payer_name: string | null
  canonical_fund_holder_name: string | null
  canonical_beneficiary_name: string | null
  canonical_amount: number | null
  party_identity_status: 'confirmed_current' | 'confirmed_pair' | 'unconfirmed'
  confirmed_party_payer_name: string | null
  confirmed_party_beneficiary_name: string | null
  party_identity_source_lineage_id: string | null
  party_identity_confirmed_at: string | null
}

export function mapTransferSlipTruth(row: TransferSlipOperationalTruthRow): TransferSlipQueueRow {
  return {
    taskId: row.task_id,
    itemId: row.item_id,
    intakeId: row.intake_id,
    sourceMessageId: row.source_message_id,
    createdAt: row.task_created_at,
    taskStatus: row.task_status,
    senderName: row.evidence_sender_name,
    recipientName: row.evidence_recipient_name,
    amount: row.evidence_amount == null ? null : Number(row.evidence_amount),
    transferAt: row.evidence_transfer_at,
    reviewStatus: row.review_status,
    route: row.route_target ?? row.current_room,
    sourceChannel: row.source_channel,
    sourceRoomName: row.source_room_name,
    sourceSenderName: row.source_sender_name,
    sourceReceivedAt: row.source_received_at,
    dataReviewStatus: row.data_review_status,
    dataReviewNote: row.data_review_note,
    candidateDepartments: row.candidate_departments ?? [],
    expenseType: row.expense_type,
    laborAmount: row.labor_amount == null ? null : Number(row.labor_amount),
    duplicateOf: row.duplicate_of,
    transactionId: row.transaction_id,
    senderBankName: row.evidence_sender_bank_name,
    senderAccountLast4: row.evidence_sender_account_last4,
    recipientBankName: row.evidence_recipient_bank_name,
    recipientAccountLast4: row.evidence_recipient_account_last4,
    bankReference: row.evidence_bank_reference,
    paymentPartyConfidence: row.payment_party_confidence == null ? null : Number(row.payment_party_confidence),
    analysisConfidence: row.analysis_confidence == null ? null : Number(row.analysis_confidence),
    analysisModel: row.analysis_model,
    notes: row.notes,
    truthStatus: row.truth_status,
    isPostable: row.is_postable,
    canonicalPayerName: row.canonical_payer_name,
    canonicalFundHolderName: row.canonical_fund_holder_name,
    canonicalBeneficiaryName: row.canonical_beneficiary_name,
    canonicalAmount: row.canonical_amount == null ? null : Number(row.canonical_amount),
    partyIdentityStatus: row.party_identity_status,
    confirmedPartyPayerName: row.confirmed_party_payer_name,
    confirmedPartyBeneficiaryName: row.confirmed_party_beneficiary_name,
    partyIdentitySourceLineageId: row.party_identity_source_lineage_id,
    partyIdentityConfirmedAt: row.party_identity_confirmed_at,
  }
}
