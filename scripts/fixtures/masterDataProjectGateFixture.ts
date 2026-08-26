import type { MasterCandidate, MasterSourceEvidence } from '../../src/pages/MasterDataCenter/masterDataReview'
import type { MasterProjectOption, MasterWorkPackageOption } from '../../src/services/masterDataProjectGate'

export type ProjectGateFixtureCandidate = MasterCandidate & { archive_after: string }

export function createMasterDataProjectGateFixture() {
  const projects: MasterProjectOption[] = [
    { id: 'fixture-project-panthong', name: 'พานทอง', code: 'PT-01', status: 'active', project_name: 'บ้านพักอาศัย', province: 'ชลบุรี', location_detail: 'อำเภอพานทอง', property_type: 'บ้านพักอาศัย' },
    { id: 'fixture-project-nuanchan', name: 'นวลจันทร์ บ้านพักอาศัย', code: 'NC-01', status: 'active', project_name: 'บ้านพักอาศัย', province: 'กรุงเทพมหานคร', location_detail: 'นวลจันทร์', property_type: 'บ้านพักอาศัย' },
  ]
  const workPackages: MasterWorkPackageOption[] = [
    { id: 'fixture-work-panthong-electrical', project_id: 'fixture-project-panthong', parent_id: null, code: 'PT-EL', name: 'งานระบบไฟฟ้า', description: 'เนื้องานทดสอบ', status: 'active' },
    { id: 'fixture-work-nuanchan-structure', project_id: 'fixture-project-nuanchan', parent_id: null, code: 'NC-ST', name: 'งานโครงสร้าง', description: 'เนื้องานทดสอบ', status: 'active' },
  ]
  const candidates: ProjectGateFixtureCandidate[] = Array.from({ length: 53 }, (_, index) => {
    const number = String(index + 1).padStart(3, '0')
    const existingProject = index === 0
    const completeNewProject = index === 1
    return {
      id: `fixture-candidate-${number}`,
      entity_type: 'bank_account',
      display_name: `ผู้รับเงินทดสอบ ${number}`,
      normalized_name: `ผู้รับเงินทดสอบ${number}`,
      candidate_data: {
        account_last4: String(1000 + index), bank_name: 'ธนาคารทดสอบ', classification_type: 'unknown_review', project_gate_status: 'received',
        ...(existingProject ? { project_name: 'พานทอง', site_location: 'อำเภอพานทอง ชลบุรี' } : {}),
        ...(completeNewProject ? { project_name: 'โครงการใหม่ Fixture', customer_owner_name: 'เจ้าของงาน Fixture', site_location: 'ชลบุรี', responsible_name: 'Admin Fixture', work_type: 'บ้านพักอาศัย', approximate_start_date: '2026-08-25' } : {}),
      },
      confidence: 0.9,
      status: 'pending_review',
      source_table: 'financial_transactions',
      source_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      duplicate_of: null,
      classification_type: 'unknown_review', classification_confidence: 0.9, classification_evidence: ['source_reference', 'bank_account'], classification_conflicts: [], classification_version: 'fixture-v1', classified_at: '2026-08-25T03:00:00Z',
      reviewed_by: null, reviewed_at: null, review_reason: null,
      created_at: `2026-08-25T03:${String(index % 60).padStart(2, '0')}:00Z`, archive_after: '2026-11-23T03:00:00Z',
    }
  })
  const evidence = Object.fromEntries(candidates.map((candidate, index): [string, MasterSourceEvidence] => [candidate.id, {
    documentId: `fixture-document-${String(index + 1).padStart(3, '0')}`, intakeId: `fixture-intake-${String(index + 1).padStart(3, '0')}`, messageId: `fixture-message-${String(index + 1).padStart(3, '0')}`, transactionId: candidate.source_id,
    sourceRoom: index === 0 ? 'โครงการ บ้านพักอาศัย พานทอง จ.ชลบุรี' : 'ห้องทดสอบ Master Data', sourceChannel: 'local_fixture', sourceSender: index === 0 ? 'หัวหน้าช่างพานทอง' : 'Admin Fixture', attachmentId: `fixture-attachment-${index + 1}`, fileName: `fixture-${index + 1}.jpg`, bucket: null, path: null,
    receivedAt: candidate.created_at, ocrRawText: index === 0 ? 'ค่าใช้จ่ายโครงการพานทอง' : `หลักฐานทดสอบ ${index + 1}`, extractedName: candidate.display_name, extractedAccount: String(candidate.candidate_data.account_last4), aiConfidence: candidate.confidence, modelVersion: 'fixture-ocr-v1', auditId: String(index + 1), auditCount: 1,
    attachmentContentType: 'image/jpeg', transferSenderName: `ผู้โอนทดสอบ ${index + 1}`, transferSenderBank: 'KBank', transferSenderAccountLast4: '1111', transferRecipientName: candidate.display_name, transferRecipientBank: 'ธนาคารทดสอบ', transferRecipientAccountLast4: String(candidate.candidate_data.account_last4), transferAmount: 100 + index, transferAt: candidate.created_at, bankReference: `FIXTURE-${index + 1}`, paymentPartyConfidence: 0.95,
    sourceResolved: true, missingReasons: [],
  }]))
  return { candidates, evidence, projects, workPackages, dataset: 'master-data-project-first-v1', count: candidates.length }
}
