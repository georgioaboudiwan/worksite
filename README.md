# Worksite — crew, days & pay

Track construction workers: weekly planner, days worked (full / half / hours), payments in USD or LBP, and what's left to pay per day, week or month. Arabic + English. Works on the web and installs to the phone home screen.

Runs on Cloudflare: a Worker serves the app (`public/`) and the API (`src/worker.js`), data in D1 (`migrations/`).

## Deploy
Every push to `main` deploys through GitHub Actions. Repo secrets needed:
- `CLOUDFLARE_API_TOKEN` — token with Workers Scripts: Edit and D1: Edit
- `CLOUDFLARE_ACCOUNT_ID`
- `RESEND_API_KEY` — sends the release email to `ADMIN_EMAIL`

## Release emails
Add the new version at the top of `src/changelog.js`. After the deploy, the Worker emails the admin within 10 minutes (once per version).

## Local
`npm install`, `npx wrangler d1 migrations apply worksite --local`, `npm run dev`.

Set `ALLOW_SIGNUP = "false"` in `wrangler.toml` to close sign-ups.

## Mobile apps (Android and iPhone)

`android/` and `ios/` are Capacitor projects that open the live site (`server.url` in `capacitor.config.json`), so every deploy reaches the apps without a store update. Icons and splash screens come from `assets/` (`npm run assets`).

Android test build: GitHub → Actions → **Android APK** → Run workflow, then download `worksite-android` (install on the phone, allow "install unknown apps").

Play Store: in Android Studio (`npm run android`) → Build → Generate Signed Bundle, upload the `.aab` to Play Console.

iPhone (Mac with Xcode 15+): `npm install && npm run ios` → pick your team under Signing & Capabilities → Product → Archive → upload to App Store Connect.
