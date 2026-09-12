```mermaid
flowchart TD
  A[พนักงานเปิดหน้าลงเวลา] --> B[ตรวจสอบตำแหน่ง GPS]
  B --> B2[แสดง Progress bar ระหว่างตรวจ GPS]
  B2 --> C{อยู่ในรัศมีไซต์?}
  C -->|อยู่ในพื้นที่| D[ถ่ายรูปยืนยัน]
  C -->|นอกพื้นที่ / GPS ไม่แม่นยำ| E[ตรวจ GPS อีกครั้ง หรือ ขออนุมัติลงเวลานอกพื้นที่]
  E --> B
  D --> F[บันทึกเวลาเข้างานสำเร็จ]
  F --> M2[หน้า "เวลาของฉัน": สรุปวันนี้/สัปดาห์นี้/รอบจ่ายเงิน]
  G[Admin เปิดภาพรวม] --> H[สถิติวันนี้ + ความคืบหน้ารายไซต์]
  G --> I[รายการที่ต้องอนุมัติ แยกตามสถานะ]
  G --> I2[การ์ดรายการรออนุมัติ + รายชื่อพนักงานที่ต้องติดตามวันนี้]
  N[Admin เดสก์ท็อปเปิด "เวลาของฉัน"] --> N2[แถบลงเวลาเข้า/ออกอยู่บนสุดของหน้าเดียวกัน - ไม่มีหน้าลงเวลาแยก]
  N2 --> B
  J[แชททีม] --> K[ห้องกลุ่ม/ส่วนตัว]
  J --> L[คำสั่งลงเวลาผ่านแชท -> Task Card ยืนยัน/ยกเลิก]
```

# Clock-In / Admin / Chat UI Flow (Design Review)

## Status of this document

**v1.1 — Design approved (13/09/2569).** Superseding v1.0 ("pending approval"). The reviewer
(project owner) told Claude directly, in chat, that the design is approved — this is the actual
authorization per the "Approval mechanism" section below, given both by clicking "อนุมัติเป็นต้นแบบ"
on the review Artifact (`approved: true`, `approvedAt: 2026-09-12T20:54:04.917Z`) and by explicitly
confirming in chat afterward ("ทำไงต่อ อนุมัตแล้ว", then choosing to start implementation).

**Implementation into the real WisdomAI-React codebase has not started yet.** This document
records what was approved and corrects the screen inventory to match the final reviewed design
(v1.0's D-03 description was already stale by the time of approval — see Changelog). A separate
follow-up implementation flow document is still expected before code changes land, per "Next step
after approval" below — this v1.1 revision is a design-record correction, not that follow-up
document.

Existing behavior is still unchanged: `TIME_TRACKING_FLOW.md` (ลงเวลา), `ATTENDANCE_CLOCK_GPS_GEOFENCE_FLOW.md`,
the existing `Chat` page, and the existing mobile/desktop admin screens keep working exactly as they
do today until an implementation flow document authorizes real code changes.

## Purpose

Give the team a single reviewable place to see every screen (mobile and desktop) of three related
features before development starts:

1. **ลงเวลาเข้างาน (GPS clock-in)** — home → GPS check (now with a progress bar while GPS resolves)
   → in-site/out-of-site branch → photo confirmation → success.
2. **แอดมิน (Admin overview/approvals)** — today's stats, per-site progress, and a categorized
   approvals list (mobile and desktop), now including "รายการรออนุมัติ" mini-cards and a
   "พนักงานที่ต้องติดตามวันนี้" list on the desktop overview.
3. **แชททีม (Team chat)** — room list / thread views, including the attendance-command task card
   pattern (confirm/cancel a clock-in reported through chat).

## Where to review

- **In-app review page:** `/flow-registry/clockin-admin-chat` (admin-only route, linked from the
  Flow Registry hub). Shows this flow, a static screenshot of every screen state listed below, a
  link to the clickable prototype, and its own approve/request-changes/comment control.
- **Screenshots:** `public/flow-review/clockin-admin-chat/*.png` — 18 screens, captured at 2x scale
  directly from the design canvas artboards (not hand-drawn mockups); D-03 is now a single
  screenshot (`D-03b-mytime.png`) instead of two, per the merge below.
- **Clickable prototype:** https://claude.ai/code/artifact/10c96722-af45-490c-a9e0-256fa595d45e —
  4 artboards (พนักงาน, Admin, แชท, Desktop) on one canvas, every control wired to real state
  transitions. (Version 9 — reflects the D-03 merge.)
- **Standalone review record:** https://claude.ai/code/artifact/6087932a-cbd7-476d-8d7b-9c259cdf79b3
  (Version 33) — 24 review comments, all addressed except the two open items under "Still open."

## Screen inventory (corrected — see Changelog)

| ID | Screen | Notes |
| --- | --- | --- |
| M-01 | ลงเวลา — หน้าหลัก / ตรวจ GPS / ถ่ายรูป / สำเร็จ | full clock-in flow, mobile. Home-screen messaging contradiction fixed (M-01a); progress bar added during the GPS check (M-01b). |
| M-02 | เวลาของฉัน — วันนี้ / สัปดาห์นี้ / รอบจ่ายเงิน | hours summary, ring chart, days-worked headline stat, 3-column day rows (เข้า/วันที่/ออก), weekly bar chart, history. "เดือนนี้" reframed as "รอบจ่ายเงิน" (pay-cutoff period) with prev/next controls. |
| M-03 | แอดมิน — ภาพรวม / อนุมัติ / เมนู | mobile admin, 3 tabs. Only the GPS clock-in flow has a written, code-verified flow doc so far (`ATTENDANCE_CLOCK_GPS_GEOFENCE_FLOW.md`); this screen itself has no separate flow spec yet. |
| M-04 | แชท — รายการห้อง / สนทนา | mobile chat, incl. attendance task card |
| D-01 | ภาพรวม (Dashboard) | desktop admin dashboard. Added "รายการรออนุมัติ" mini-cards and "พนักงานที่ต้องติดตามวันนี้" list. A proposed tabbed second view ("มุมมองของหัวหน้างาน" / supervisor's view) is **not** part of this approval — still undefined, see "Still open." |
| D-02 | รายการที่ต้องอนุมัติ | desktop approvals table |
| D-03 | เวลาของฉัน (รวมลงเวลา) | **Corrected from v1.0.** No longer a separate desktop clock-in page. The standalone clock-in card was removed; the clock-in status + "ลงเวลาเข้า" button now live as a compact row at the top of the "เวลาของฉัน" page, above the ring chart / weekly bar chart / history table. One screen instead of two. |
| D-04 | แชท (Split View) | desktop two-pane chat. A persistent chat-notifier widget concept was proposed and **deferred** by the reviewer ("เก็บไว้ก่อน โฟกัสงานเดิมให้เสร็จ") — not designed, not part of this approval. |

## Design reference used

- Color/typography tokens taken from `src/theme.ts` (primary `#A65940`, dark `#71392C`, background
  `#F8F6F5`, divider `#E5DFDC`, Inter font, 12px radius) — same tokens the review page itself uses.
- Desktop sidebar/topbar matched to `Sidebar.tsx` / `TopBar.tsx` (dark `#333333` sidebar, active item
  `rgba(166,89,64,.72)` + `#FABFB2` left accent bar, white topbar with bottom border).
- Chat visual language (gradients, card borders, shadows) is intentionally more polished than a
  strict pixel match, per explicit direction during design review — the real `Chat` page's feature
  set (rooms, voice notes, location share, attendance-command task cards) is the functional
  reference, since no desktop split-view chat existed to match pixel-for-pixel.
- Brand mark cropped/alpha-keyed from `public/branding/wisdom-power-system-logo-transparent.png`.
  The live app does not render a logo image anywhere else in-UI (confirmed by code search) — this
  mark is used only on the mobile mockups' top bar per the reviewed design.

## Approval mechanism

The review page's approve/comment state (whether the in-app `/flow-registry/clockin-admin-chat`
page's `localStorage` marker, or the standalone review Artifact's own `approved` flag) is a
lightweight visual marker only — it is **not** the system of record. The actual authorization to
start implementation is the reviewer telling Claude directly (in the `00 | Program Development`
chat room) that the design is approved, same as every other change on this project. That statement
was given on 13/09/2569 (see "Status of this document" above), which is what makes this v1.1
revision, and the implementation work it authorizes, legitimate — not the button click alone.

## Still open — not covered by this approval

1. **D-01 (ภาพรวม) — tabbed dashboard, 2nd view undefined.** The reviewer wants to discuss what the
   proposed second tab ("มุมมองของหัวหน้างาน" / supervisor's view) actually shows before this gets
   designed. Do not build a second dashboard view until that is resolved.
2. **D-04 (แชท) — persistent chat-notifier widget concept. Deferred** by explicit reviewer choice.
   Do not design or build until raised again.

## Next step after approval

A follow-up implementation flow document (superseding this one) is still required before code
changes land, per the Flow Registry rule this document opened with. It should specify: the actual
attendance/GPS write path (reusing `attendance_sessions` per `ATTENDANCE_CLOCK_GPS_GEOFENCE_FLOW.md`),
which of the mobile admin/chat screens are net-new pages versus visual refreshes of existing ones
(`MobileOverview`, `Chat`, `TimeTracking`, `Dashboard`), and a build/test/rollout plan per the Flow
Registry's standard closing checklist. Because this session has no shell access on the developer's
machine, lint/build/test for that implementation work must be run and confirmed by the developer
themselves after each change is staged — this document does not claim that verification has happened.

## Changelog

### v1.1 — 2026-09-12 (13/09/2569) — Design-record correction, approval recorded

- **Rationale:** v1.0 was registered before the design review finished; by the time the reviewer
  approved the prototype, 24 review comments had been addressed and the design itself had changed
  (most notably D-03), leaving v1.0's screen inventory stale relative to what was actually approved.
  This revision brings the document in line with the approved design before any implementation
  flow document is written against it.
- **What changed:** screen inventory corrected for D-03 (single merged "เวลาของฉัน" screen, was two
  screens), M-01 (messaging fix + GPS progress bar), M-02 (days-worked stat, 3-column day rows,
  "รอบจ่ายเงิน" reframing), D-01 (approvals mini-cards + follow-up list); added the "Still open"
  section for the two items this approval does not cover (D-01 tabbed view, D-04 widget); added this
  Changelog and an explicit approval record.
- **Flowchart:** updated to show the GPS-check progress bar, the desktop "เวลาของฉัน" entry point
  into the same clock-in flow (replacing the old separate desktop clock-in screen), and the D-01
  admin mini-cards. The underlying process (GPS check → photo → success; admin approvals; chat)
  is unchanged — this update reflects screen-level consolidation and additive UI, not a new process,
  which is why no routing/permissions/integration change is recorded below.
- **Impact:** documentation only. No code, data, routing, or permissions changed by this revision.
  The real app (`TIME_TRACKING_FLOW.md`, `ATTENDANCE_CLOCK_GPS_GEOFENCE_FLOW.md`, existing `Chat`,
  `MobileOverview`, `Dashboard`, `TimeTracking` pages) is unaffected until a follow-up implementation
  flow document and actual code changes are approved and merged.
- **Migration:** none (no data or schema affected).
- **Verification:** reviewed against the live review Artifact state (24 comments, `approved: true`,
  `approvedAt: 2026-09-12T20:54:04.917Z`) and the Design-canvas prototype (Version 9) at the time of
  writing; no build/lint/test applicable to a docs-only change.
- **Rollback:** revert this file to v1.0 via git if the corrected screen inventory or changelog is
  disputed; this does not touch any other file, so rollback is a single-file revert with no
  side effects.

### v1.0 — pending approval (original)

Registered before any production code was written, per the Flow Registry rule ("ก่อนแก้ทุก Module
ต้องตรวจว่ามี Flow หรือไม่; หากไม่มีต้องสร้าง Flow ก่อนเริ่มแก้"). Described the initial mockup
screen inventory, since corrected above.
