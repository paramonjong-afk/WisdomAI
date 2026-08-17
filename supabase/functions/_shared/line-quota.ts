export type LinePriority = 'normal' | 'high' | 'critical'

export type LinePushResult = {
  status: 'sent' | 'failed' | 'skipped' | 'quota_blocked'
  error: string | null
  usage?: number
  budget?: number
  projectedUsage?: number
}

const integerEnv = (name: string, fallback: number) => {
  const value = Number(Deno.env.get(name))
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

export const lineBudgetConfig = () => {
  const budget = integerEnv('LINE_MONTHLY_BUDGET', 300)
  return {
    budget,
    softLimit: Math.min(integerEnv('LINE_PUSH_SOFT_LIMIT', 180), budget),
    highLimit: Math.min(integerEnv('LINE_PUSH_HIGH_LIMIT', 240), budget),
    criticalOnlyLimit: Math.min(integerEnv('LINE_PUSH_CRITICAL_LIMIT', 270), budget),
    estimatedRecipients: Math.max(1, integerEnv('LINE_ESTIMATED_RECIPIENTS_PER_PUSH', 6)),
  }
}

export function canUseLinePush(usage: number, priority: LinePriority, estimatedRecipients?: number) {
  const config = lineBudgetConfig()
  const projectedUsage = usage + (estimatedRecipients ?? config.estimatedRecipients)
  if (projectedUsage > config.budget) return { allowed: false, reason: 'monthly_budget_exhausted', projectedUsage, ...config }
  if (usage >= config.criticalOnlyLimit && priority !== 'critical') return { allowed: false, reason: 'critical_only_reserve', projectedUsage, ...config }
  if (usage >= config.highLimit && priority !== 'critical') return { allowed: false, reason: 'critical_only', projectedUsage, ...config }
  if (usage >= config.softLimit && priority === 'normal') return { allowed: false, reason: 'high_priority_only', projectedUsage, ...config }
  return { allowed: true, reason: null, projectedUsage, ...config }
}

async function monthlyUsage(token: string) {
  const response = await fetch('https://api.line.me/v2/bot/message/quota/consumption', {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`LINE quota API ${response.status}`)
  const body = await response.json() as { totalUsage?: number }
  return Number(body.totalUsage ?? 0)
}

export async function sendLinePush(options: {
  token: string | null | undefined
  to: string | null | undefined
  messages: unknown[]
  priority?: LinePriority
  estimatedRecipients?: number
}): Promise<LinePushResult> {
  if (!options.to) return { status: 'skipped', error: 'missing_line_destination' }
  if (!options.token) return { status: 'failed', error: 'missing_line_channel_access_token' }

  let usage: number
  try {
    usage = await monthlyUsage(options.token)
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }

  const decision = canUseLinePush(usage, options.priority ?? 'normal', options.estimatedRecipients)
  if (!decision.allowed) {
    return {
      status: 'quota_blocked', error: decision.reason, usage,
      budget: decision.budget, projectedUsage: decision.projectedUsage,
    }
  }

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ to: options.to, messages: options.messages.slice(0, 5) }),
  })
  if (!response.ok) {
    return { status: 'failed', error: `LINE ${response.status}: ${(await response.text()).slice(0, 300)}`, usage, budget: decision.budget, projectedUsage: decision.projectedUsage }
  }
  return { status: 'sent', error: null, usage, budget: decision.budget, projectedUsage: decision.projectedUsage }
}
