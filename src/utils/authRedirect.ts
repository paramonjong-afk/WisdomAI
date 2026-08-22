export const getPasswordResetRedirectUrl = () => {
  const configured = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, '')
  if (configured) return `${configured}/reset-password`
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(window.location.origin)) {
    return 'https://wisdomai-react.vercel.app/reset-password'
  }
  return `${window.location.origin}/reset-password`
}
