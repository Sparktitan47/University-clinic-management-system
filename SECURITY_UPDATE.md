# Security Update and Review

## Summary

The browser app previously relied on client-side role checks while Firestore granted every signed-in account broad access. This update moves authorization to Firebase custom claims and database rules, restores self-service enrollment only for admin-approved non-admin IDs after email verification, routes appointment mutations through trusted Cloud Functions, and removes known unsafe HTML rendering and persistent browser caching.

**Review status: source changes prepared; deployment and live Firebase verification are still required.** Do not use real clinic data until the deployment checklist below is complete.

## Changes made

### Access control and identity

- Replaced the permissive rules with per-collection authorization in `firestore.rules`. Registry reads are limited to the user's own record and admins; registry listing and edits are admin-only. Chat access is limited to participants, appointment reads to the student, assigned clinical staff, or admins, pharmacy writes to pharmacists/admins, and site settings writes to admins. Unmatched paths deny access.
- Dashboards now derive role and clinic ID from Firebase Auth custom claims (`role`, `clinicId`), then verify the role against the user's registry record. Browser storage is no longer an authorization source.
- Replaced the unsafe signup flow with verified-email enrollment. An admin must pre-approve the clinic ID and email in the registry. The trusted `completeEnrollment` function verifies the Auth email, denies admin enrollment, claims the ID for one Auth UID, and issues the role from the registry as custom claims. The browser cannot write registry ownership or select a role.
- Added `scripts/set-user-claims.js`. It issues claims only when the Auth account email, registry ID, and registry role agree. Run it only with trusted Admin SDK credentials.
- Added a minimal `directory/{id}` record containing only name and role. Student and staff screens use it for display names instead of reading another person's full registry record. Registry keeps recovery/auth email and care assignments restricted.

### Appointment integrity

- Added the `bookAppointment` callable in `functions/index.js`. It verifies the student's role and care-team assignment, checks that the selected slot is still available, and atomically marks it taken and creates the appointment in a Firestore transaction.
- Added `setAppointmentStatus` for assigned clinical staff. It only permits pending appointments to be confirmed or cancelled, and cancellation releases the slot in the same transaction.
- The public enrollment callable cannot assign an admin claim. A permanent first admin is bootstrapped out of band using the trusted claims script, and that account is not exposed to public signup.
- Direct client creation of appointments and direct staff status changes are denied by the Firestore rules.

### Data rendering, storage, and logs

- Escaped database-backed pharmacy, appointment, chat, registry, and directory values before inserting them into HTML. Appointment buttons use event listeners rather than inline JavaScript handlers.
- Removed Firestore persistent disk caching and added a startup cleanup attempt for a cache created by an earlier version. Dashboard reads wait for this cleanup attempt.
- Removed raw Firebase error objects/messages from application logs; logs retain error codes only.
- Added `database.rules.json` to restrict Realtime Database presence writes to the authenticated user's own ID and limit reads to authenticated staff/admins or the user themselves.

## Deployment checklist

1. Back up the existing Firebase data and confirm the target project before deploying.
2. Bootstrap the permanent first admin out of band with a verified Auth email, `registry/ADMIN-001`, and `node scripts/set-user-claims.js <auth-uid> ADMIN-001 admin`. Enable MFA, keep credentials private, and maintain a controlled recovery method.
3. Install Cloud Function dependencies with `npm --prefix functions install` and deploy with `firebase deploy --project uni-clinic-ce45a --only firestore:rules,database,functions`.
4. Admins add regular users' IDs and approved emails in the dashboard. Users create an account, verify that email, then finish enrollment in the app. The server derives the role from the registry; public enrollment rejects the admin ID.
5. Create `directory/{id}` documents containing only `{ name, role }` for existing accounts. New records created in the admin UI and successful enrollments maintain this directory going forward.
6. Use the Firebase Rules simulator to verify anonymous access is denied; students cannot read another student's appointment/chat/report; staff cannot access unrelated chats or appointments; pharmacists cannot edit registry/reports; and only admins can list or alter registry data.
7. Enable Firebase App Check for the web app and enforce it on callable functions before production use. The current functions verify Auth claims but App Check enforcement is not enabled because this repository has no App Check provider/site-key configuration.
8. Configure the actual hosting provider to serve only the app's public pages/assets, force HTTPS, and set HSTS, CSP (`frame-ancestors 'none'`, `object-src 'none'`), `X-Content-Type-Options: nosniff`, a restrictive `Referrer-Policy`, and `Cache-Control: no-store`. The hosting provider is not identified in this repository, so those response headers could not be safely configured here.
9. On shared devices, clear site data for the previous version after deployment. The app attempts Firestore cache cleanup at startup, but browsers may have old data on disk if another tab is still open or cleanup fails.

## Review findings and remaining work

### Addressed in source

- Broad Firestore access, public registry reads, and client-controlled signup/role assignment. Self-service enrollment now uses verified email and server-side registry checks.
- Direct appointment creation and status mutation, including the double-booking race.
- Stored XSS sinks identified in pharmacy and appointment rendering, plus inline appointment handlers.
- Persistent Firestore browser cache for clinic data.
- Raw Firebase error details in browser logs.

### Requires deployment or operational decisions

- **Firebase deployment:** Rules and callable functions are not active until deployed to the correct project. Current users will lose database access until custom claims are provisioned.
- **Identity migration:** Existing Auth accounts may use emails that were selected through the old signup flow. Verify each account holder's identity and email before issuing claims; do not bulk-assign roles based only on old registry values.
- **App Check and abuse controls:** App Check is not initialized/enforced. Firebase Auth throttles sign-in/reset abuse, but chat/report submission rate limits are not implemented. Add App Check and server-side quotas before public production access.
- **Hosting headers:** The actual hosting provider and domain configuration are absent, so HTTPS/HSTS/CSP/cache headers require deployment-side configuration and verification.
- **Retention, deletion, and audit trails:** No retention schedule, user data export/deletion workflow, or server-side audit trail for sensitive reads/exports is implemented in this static app. Define these requirements and add trusted backend workflows before clinical use.
- **Third-party services:** Firebase SDK and Google Fonts are loaded from Google. No analytics or session replay integration was found in the supplied files. Confirm data processing terms and minimize referrer/IP disclosure through hosting policy.
- **Secrets and API restrictions:** `firebase-config.js` contains a Firebase web API key, which is expected to be public client configuration. Restrict it to required APIs and approved web origins in Google Cloud Console. Keep Admin SDK credentials outside this project.

### Not observed in supplied source

- No server-side URL fetcher, webhook, import, or media handler was found, so no SSRF path was identified.
- No SQL/NoSQL query-building endpoint exists; the app uses Firestore SDK calls. The main Firestore risk was authorization, now addressed in the supplied rules.
- The project has no package manifest for the frontend or lockfile. The Firebase browser SDK is pinned to version `10.13.0`; a complete dependency provenance/audit review needs the deployed hosting/build setup.

## Verification performed

This review checked the changed source and rules for the old broad grants, client-side identity writes, direct booking writes, persistent Firestore enablement, inline appointment handlers, and unescaped database-backed fields. No live Firebase project was accessed, rules were not deployed, and runtime tests were not run. The Firebase Rules simulator and staged account tests in the deployment checklist are required before launch.
