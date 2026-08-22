import { createSignature, generateAttemptId, globalMutationAttemptStore } from './operation-center'
import { reportCentralError } from './centralErrorReporter'
import { userError } from './userError'

type MutationAttemptRequest = Record<string, unknown>

export type RunWithAttemptOptions<TInput extends MutationAttemptRequest> = {
  module: string
  action: string
  actorProfileId: string | null | undefined
  companyId: string | null | undefined
  request: TInput
  operation: () => unknown | PromiseLike<unknown>
  requestId?: string
  errorCode?: string
  errorAction?: string
}

const toActor = (actorProfileId?: string | null): string => actorProfileId?.trim() ? actorProfileId : 'system'

export const runWithMutationAttempt = async <TInput extends MutationAttemptRequest, TResponse = { data?: unknown; error?: unknown }>({
  module,
  action,
  actorProfileId,
  companyId,
  request,
  operation,
  requestId,
  errorCode = 'UNHANDLED',
  errorAction,
}: RunWithAttemptOptions<TInput>): Promise<TResponse> => {
  const attemptId = requestId || generateAttemptId()
  const attemptRecord = {
    id: attemptId,
    module,
    action,
    status: 'pending' as const,
    actor_profile_id: toActor(actorProfileId),
    company_id: companyId ?? null,
    input: request,
    created_at: new Date().toISOString(),
    request_id: attemptId,
    signature: createSignature(request),
  }

  globalMutationAttemptStore.upsert(attemptRecord)

  try {
    const response = await Promise.resolve(operation())
    if (
      response &&
      typeof response === 'object' &&
      'error' in (response as Record<string, unknown>) &&
      (response as Record<string, unknown>).error
    ) {
      throw (response as Record<string, unknown>).error
    }

    globalMutationAttemptStore.upsert({ ...attemptRecord, status: 'success' })
    return response as TResponse
  } catch (error) {
    const message = error instanceof Error ? error.message : userError(error)
    reportCentralError(error, {
      module,
      source: 'web:mutation-attempt',
      title: `Mutation failed: ${module}/${action}`,
      severity: 'error',
    })
    globalMutationAttemptStore.upsert({
      ...attemptRecord,
      status: 'error',
      error: message,
      error_code: errorCode,
      error_action: errorAction,
    })
    throw error
  }
}
