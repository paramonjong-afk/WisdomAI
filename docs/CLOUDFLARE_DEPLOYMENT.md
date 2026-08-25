# Cloudflare Deployment

Production Pages deploys through Cloudflare Git Integration from GitHub `main`. This is the only normal release path.

- Project: `news-realestate`
- Build command: `npm run build`
- Output directory: `dist`
- Required Production variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Release verification: `https://wisdomai.pages.dev/release.json`

## Normal release

1. Read `docs/RELEASE_INCIDENT_PLAYBOOK.md` and relevant Flow documents.
2. Run targeted tests, typecheck, lint and build from a clean release commit.
3. Fetch GitHub `main`, confirm the release commit is not behind, then push to `main`.
4. Wait for `Verify Cloudflare Pages Build` to pass and Cloudflare Git Integration to finish.
5. Confirm `release.json.revision` equals the pushed commit.
6. Use an authenticated session to smoke test the changed page and its destination/Intake/Audit path.

## Manual fallback

`npm run deploy:cloudflare` uses Wrangler and an Account API Token. It is allowed only when Git Integration is unavailable and the fallback is explicitly authorized. A `401` from a local Token is a fallback credential problem, not a reason to repeat the command or block the normal Git path.

Keep Production variables and credentials in Cloudflare/GitHub secrets. Never commit `.env` files or expose secret values in logs or conversations.
