export type WorkCategory = 'completed' | 'in_progress' | 'planned' | 'issue' | 'risk' | 'material' | 'safety' | 'general'
export type ReviewStatus = 'pending' | 'confirmed' | 'dismissed'
export interface WorkSummaryItem { id: string; source_message_id: string; work_date: string; category: WorkCategory; summary_text: string; assignee_text: string | null; status: ReviewStatus; project_id: string | null }
export interface WorkProject { id: string; name: string; code: string | null }
export interface LineMessageSource { id: string; occurred_at: string; line_group_id: string | null; line_user_id: string | null; line_senders: { display_name: string | null } | null; line_groups: { display_name: string | null } | null }
export interface MessageProjectMapping { message_id: string; project_id: string; assignment_source: 'hashtag' | 'group_default' | 'reply_context' | 'manual'; projects: { name: string; code: string | null } | null }
