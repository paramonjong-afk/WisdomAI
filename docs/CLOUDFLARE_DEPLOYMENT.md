# Cloudflare Deployment

Production Pages deploys through Cloudflare Git Integration from GitHub `main`. This is the only release path.

- Project: `wisdomai`
- Build command: `npm run build`
- Output directory: `dist`
- Required Production variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Release verification: `https://wisdomai.pages.dev/release.json`

## Normal release

1. Read `docs/RELEASE_INCIDENT_PLAYBOOK.md` and relevant Flow documents.
2. Run targeted tests, typecheck, lint and build from a clean release commit.
3. Fetch GitHub `main`, confirm the release commit is not behind, then push to `main`.
4. Wait for `Verify Cloudflare Pages Build` to pass and Cloudflare Git Integration to finish.
5. Run `npm run deploy:cloudflare`. This command does not deploy an artifact; it waits until `release.json.revision` equals the pushed commit and checks the public runtime.
6. Use an authenticated session to smoke test the changed page and its destination/Intake/Audit path.

## Central environment

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured once in Cloudflare Pages Settings for Production/Preview. Cloudflare injects them at build time. Local scripts must not read, copy, print, or synchronize these values.

ห้าม Manual upload จาก `dist` ที่ build ในเครื่อง และห้ามใช้ `wrangler pages deploy` สำหรับ Production เพราะ artifact ดังกล่าวอาจไม่มีค่ากลางของ Cloudflare แม้ source commit จะถูกต้อง หาก Automatic Deployment ขัดข้อง ให้แก้ Git Integration หรือ rollback ไป deployment ที่สร้างจาก GitHub เท่านั้น

Keep Production variables and credentials in Cloudflare secrets. Never commit `.env` files or expose secret values in logs or conversations.
