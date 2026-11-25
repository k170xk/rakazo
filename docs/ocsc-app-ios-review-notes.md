# OCSC Intelligence Capacitor iOS — App Review notes draft

Copy the filled sections into App Store Connect → App Review Information.
Keep real review credentials only in App Store Connect; do not commit them.

## 1. Screen recording

**Demo video URL**: `[paste physical-device recording URL]`

Recorded on a physical iPhone. The recording must start at launch and show:

- Sign-in through Evolve / Microsoft in the system authentication sheet
- Opening a bot chat and sending a message
- Attaching a photo (camera or library permission prompt)
- Optional voice / microphone permission if voice is enabled for the review account
- Optional notifications permission prompt (Enable notifications dialogue)
- Account → Delete account entry point (do not complete deletion on the shared review account)
- AI data-sharing consent if/when that Capacitor flow is deployed (Allow and Not now)

## 2. App purpose

**What problem does this app solve?**
OCSC staff need a private, always-available assistant for team work: chatting with configured agents, attaching files, receiving completion alerts, and opening downloads without leaving the secure OCSC environment.

**What value does it provide?**
OCSC Intelligence is the native iOS shell for the organisation’s private agent workspace. Beyond the website, the app provides system Microsoft sign-in (Safari authentication session with associated domains), OneSignal push for run completion and approvals, native Quick Look / share-sheet file handling, keyboard-safe chat layout, and camera / microphone / photo-library access for attachments and voice.

## 3. Access instructions and test credentials

1. Launch OCSC Intelligence.
2. Sign in with the Evolve / Microsoft review account below.
3. Open the review bot chat and send a short message.
4. Attach an image from Photos when prompted.
5. If offered, enable notifications from the in-app dialogue.
6. Open Account settings to confirm Delete account is available.
7. Do not change production model routing, billing, or organisation settings.

**Test account**

- Username: `[review email — store only in App Store Connect]`
- Password: `[review password — store only in App Store Connect]`
- Notes: Account remains active through `[date at least 2 weeks after submission]`. Billing is disabled on this deployment. Sign-in is Evolve Microsoft SSO only.

**Feature flags / gated features**
No review-only bait-and-switch flags. Any remote configuration that changes user-visible features for this build must be reachable by the review account and listed here before submission.

## 4. External services

| Service | Purpose |
| --- | --- |
| Evolve (`evolve.ocsc.me`) | Organisation SSO entry |
| Microsoft identity | Staff authentication |
| Supabase Auth host | Session / auth callbacks allowed in the Capacitor web view |
| OCSC API / web (`computer.ocsc.me`) | App UI, agent runs, account management |
| Configured model / voice / memory providers | Process prompts, attachments, and voice when the account uses them |
| OneSignal | Push notification delivery |
| Apple Push Notification service | Device push transport |

Third-party AI recipients that receive personal content must be named in the privacy policy and in the in-app consent flow before the first request (Guideline 5.1.2(i)).

## 5. Regional differences

This app is intended to function consistently for OCSC staff across regions where it is distributed. If China mainland distribution is enabled, remove banned AI brand terms from all metadata locales or exclude that storefront.

## 6. Regulated industry documentation

Not applicable. This is an internal productivity / AI assistant app, not a medical device, VPN, gambling, or finance product.

## Reviewer notes — native value (Guideline 4.2)

Please note the native capabilities that go beyond a Safari bookmark:

- `SystemSignIn` uses `ASWebAuthenticationSession` with `webcredentials:computer.ocsc.me`
- `NativeFiles` downloads over HTTPS and presents Quick Look / share sheet
- OneSignal push with production APNs entitlement
- Camera, microphone, and photo-library usage strings for attachments and voice
- Capacitor keyboard resize so the composer stays visible
