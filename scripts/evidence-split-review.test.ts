import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const component = readFileSync('src/components/EvidenceSplitReviewWorkspace.tsx', 'utf8')
const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')
const drawer = readFileSync('src/pages/MasterDataCenter/MasterDataReviewDrawer.tsx', 'utf8')
const sourceCard = readFileSync('src/pages/MasterDataCenter/MasterDataSourceReferenceCard.tsx', 'utf8')
const projectPanel = readFileSync('src/pages/MasterDataCenter/MasterDataProjectGatePanel.tsx', 'utf8')
const standard = readFileSync('docs/EVIDENCE_SPLIT_REVIEW_STANDARD.md', 'utf8')
const agents = readFileSync('AGENTS.md', 'utf8')

for (const token of [
  'evidence-split-review-workspace',
  'evidence-preview-pane',
  'evidence-review-pane',
  'หลักฐานต้นฉบับ',
  'กลับไปตรวจข้อมูล',
  "kind === 'image'",
  "kind === 'pdf'",
  'เปิดในแท็บใหม่ (ตัวเลือกสำรอง)',
  "display: { xs: preview ? 'none' : 'flex', md: 'flex' }",
]) assert.match(component, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

for (const token of ['EvidenceSplitReviewWorkspace', 'preview={props.preview}', 'onClosePreview', 'onRetryPreview', 'onOpenPreviewExternal']) {
  assert.match(drawer, new RegExp(token))
}

const openSourceBody = page.slice(page.indexOf('const openSource = async'), page.indexOf('const closeEvidencePreview'))
assert.doesNotMatch(openSourceBody, /window\.open/, 'primary evidence action must stay in the current page')
assert.match(page, /evidencePreviewRequestRef/)
assert.match(page, /requestId !== evidencePreviewRequestRef\.current/)
assert.match(page, /const closeEvidencePreview = \(\) => \{ evidencePreviewRequestRef\.current \+= 1; setEvidencePreview\(null\) \}/)
assert.match(page, /setEvidencePreview\(\{ \.\.\.previewBase, url: signed\.data\.signedUrl, loading: false, error: null \}\)/)
assert.match(page, /openEvidenceInNewTab/)
assert.match(page, /localEvidencePreviewUrl/)

assert.match(sourceCard, /ดูหลักฐานข้างข้อมูล/)
assert.match(projectPanel, /ดูรูป\/เอกสารข้างข้อมูล/)
assert.doesNotMatch(sourceCard + projectPanel, /OpenInNewOutlined/)

assert.ok(standard.startsWith('```mermaid'), 'the central standard must start with a renderable flowchart')
for (const token of ['Desktop', 'Tablet/Mobile', 'Discard stale response', 'Signed URL', 'Failure / Retry / Recovery', 'Audit และ Owner']) {
  assert.match(standard, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}
assert.match(agents, /Evidence Drawer Standard/)
assert.match(agents, /docs\/EVIDENCE_SPLIT_REVIEW_STANDARD\.md/)

console.log('evidence split review passed: same-page image/PDF, responsive mounted review state, stale-request isolation, retry/fallback and central Drawer standard')

