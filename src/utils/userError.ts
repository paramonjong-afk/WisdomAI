import { fallbackError } from './error-center'
import { reportCentralError } from './centralErrorReporter'

export function userError(error: unknown, fallback = 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่') {
  reportCentralError(error)
  return fallbackError(error, fallback).message
}
