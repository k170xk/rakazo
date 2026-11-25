# OCSC Intelligence Capacitor iOS — App Store preflight report

Generated against the Capacitor shell in `ocsc-app` for the existing App Store listing.
This report does not change App Store Connect or production services.

## Preflight Report

### Rejections found

- [GUIDELINE 5.1.1(i)] App Store Privacy Policy URL must be a public, accurate OCSC policy
  - `computer.ocsc.me/privacy` currently serves the SPA shell, not a standalone policy document
  - `https://rakazo.com/privacy/` is public and names AI providers, but is Inbox Zero / Rakazo branded
  - Fix: Publish an OCSC-branded policy URL, set `PRIVACY_POLICY_URL` on the API, and enter that URL in App Store Connect

- [GUIDELINE 2.1] New-submission review notes incomplete until credentials and device recording exist
  - Draft: `docs/ocsc-app-ios-review-notes.md`
  - Fix: Create a durable review Microsoft/Evolve account, record the physical-device demo, paste the URL and credentials into App Store Connect only

### Warnings

- [GUIDELINE 4.2] Thin-client risk: the binary is a Capacitor web view of `computer.ocsc.me`
  - Mitigations already in the binary: system sign-in sheet, native file Quick Look/share, OneSignal push, keyboard resize, camera/mic/photo usage
  - Emphasise these in review notes and the screen recording

- [GUIDELINE 4.8] Sign in with Apple
  - Live auth capabilities show Evolve Microsoft SSO only (`passwordAuth: false`, no Google/Facebook social list)
  - SIWA is not required while only organisation Microsoft SSO is offered. Re-check if consumer social logins are added

- [GUIDELINE 3.1.1] In-app purchase / Stripe digital goods
  - Live capabilities report `billing: false` for this deployment — current risk is low
  - If billing is later enabled in the Capacitor shell, Stripe checkout for digital credits is an App Store rejection unless replaced with IAP (or a permitted external-purchase path)

- [GUIDELINE 5 / China DST] Metadata must not contain banned AI brand terms if China is selected
- [App Privacy questionnaire] Confirm Photos/Videos (attachments) and Audio Data (voice) answers match the review account’s real flows
- [OneSignal] Confirm the dashboard does not enable cross-app tracking / ATT unless `NSUserTrackingUsageDescription` and ATT prompting are added
- [Associated domains] AASA at `computer.ocsc.me` includes both `me.ocsc.intelligence` and `me.ocsc.intelligence.ios`; the Xcode target uses `me.ocsc.intelligence.ios`

### Passed

- [SDK] Local Xcode 26.4.1 is available for the iOS 26 SDK upload requirement
- [Privacy manifest] App target now includes `ocsc-app/ios/App/App/PrivacyInfo.xcprivacy` in Copy Bundle Resources (`UserDefaults` CA92.1, `FileTimestamp` C617.1, tracking false)
- [Entitlements] `aps-environment` is `production`; `webcredentials:computer.ocsc.me` matches the live AASA webcredentials entry
- [Info.plist] Camera, microphone, photo-library, and remote-notification background mode are declared; encryption export compliance set to non-exempt false
- [Account deletion] Web Account settings expose Delete account (`apps/web/src/components/AccountAccess.tsx`)
- [Push consent] Capacitor first-run notifications dialogue asks before the OS prompt (`EnableNotificationsDialog`)
- [GUIDELINE 5.1.2(i)] Capacitor AI data-sharing consent gate is implemented in `apps/web` (native shell only): RPC/voice chokepoints call `ensureCapacitorAiConsent`, `AiConsentDialog` names providers before Allow / Not now, and Account → AI data sharing supports revoke / withdraw-all. See `docs/ai-data-sharing-review.md`
  - Operator step before App Review: deploy the updated `apps/web` build to `computer.ocsc.me`, set `PRIVACY_POLICY_URL` on the API once the OCSC policy URL is published, then verify Allow, Not now, attachment upload blocking, voice blocking, and Account withdrawal on a physical iPhone
- [Icons / launch] Universal 1024 App Icon and launch storyboard / splash assets are present
- [Version] Marketing version `1.0`, build `1`, deployment target iOS 15.0

## Metadata pull status

`asc` 7.3.1 is installed locally. `asc auth doctor` reports no App Store Connect credentials in this environment, so the existing listing metadata could not be pulled automatically.

Manual operator step (private machine only):

```bash
asc auth login --name OcscKey --key-id KEY_ID --issuer-id ISSUER_ID --private-key /path/to/AuthKey_KEY_ID.p8
# or export ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY_PATH
asc apps list
asc metadata pull --app "<ASC_APP_ID>" --version "<VERSION>" --dir ./metadata
```

After pull, check name length, description ToS/PP links, screenshots showing the app in use, age rating, App Privacy answers, China storefront AI terms, and review notes completeness. Do not commit pulled metadata if it contains review credentials or private URLs.

## Build validation (this run)

- `npm run sync` (Capacitor iOS) succeeded with `NODE_OPTIONS=--experimental-strip-types` (required on Node 22.17 with TypeScript 7; scripts now set this)
- `xcodebuild` Release `generic/platform=iOS` with `CODE_SIGNING_ALLOWED=NO` **BUILD SUCCEEDED** against iPhoneOS 26.4 SDK
- Built app includes root `PrivacyInfo.xcprivacy`
- Related web unit tests were not re-run here because the local Node engine is below the repo `engines.node` floor

## Archive / upload steps (local, non-destructive)

From `ocsc-app`:

```bash
npm install
npm run sync
npm run ios
```

In Xcode: select a release team/signing identity → Product → Archive → Distribute App → App Store Connect.
Validate the archive before uploading. This does not submit for review by itself.

## Remaining manual actions before Submit for Review

1. Deploy Capacitor AI consent (or ship Expo instead) and verify Allow / Not now / withdraw
2. Publish OCSC privacy + terms URLs and set them in App Store Connect (+ `PRIVACY_POLICY_URL`)
3. Create durable review credentials; keep them out of Git
4. Capture the physical-device screen recording and fill `docs/ocsc-app-ios-review-notes.md`
5. Complete age rating, App Privacy answers, screenshots, support URL, and What’s New
6. Archive with Xcode 26+, upload, then submit
