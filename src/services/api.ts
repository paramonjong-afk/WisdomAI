/**
 * Reserved for HTTP clients and platform API calls.
 * Keep transport concerns outside pages and UI components.
 */
export const api = {
  baseUrl: import.meta.env.VITE_API_URL ?? '/api',
}
