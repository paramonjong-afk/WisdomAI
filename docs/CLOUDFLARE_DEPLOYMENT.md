# Cloudflare Deployment

The production Pages project is deployed through Cloudflare Git integration from main.

- Project: news-realestate
- Build command: npm run build
- Output directory: dist
- Required production variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

Keep production variables in the Cloudflare Pages project settings. Do not commit .env files or secret values. The direct Wrangler workflow is not the source of truth for this project; use the connected Git deployment and verify the resulting Pages revision before runtime smoke testing.
