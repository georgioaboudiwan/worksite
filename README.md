# Worksite — crew, days & pay

Track construction workers: weekly planner, days worked (full / half / hours), payments in USD or LBP, and what's left to pay per day, week or month. Arabic + English. Works on the web and installs to the phone home screen.

Runs on Cloudflare: a Worker serves the app (`public/`) and the API (`src/worker.js`), data in D1 (`migrations/`).

## Deploy
Every push to `main` deploys through GitHub Actions. Repo secrets needed:
- `CLOUDFLARE_API_TOKEN` — token with Workers Scripts: Edit and D1: Edit
- `CLOUDFLARE_ACCOUNT_ID`

## Local
`npm install`, `npx wrangler d1 migrations apply worksite --local`, `npm run dev`.

Set `ALLOW_SIGNUP = "false"` in `wrangler.toml` to close sign-ups.
