# University Clinic Firebase Setup

## Security prerequisites

This app now requires Firebase Authentication custom claims. The browser must never assign clinic IDs or roles. Signup is limited to non-admin IDs and emails pre-approved in the registry; do not restore the old permissive Firestore rules or old client-only signup flow.

Required Auth custom claims:

```json
{ "clinicId": "Student-2024118", "role": "student" }
```

Supported roles: `student`, `doctor`, `counsellor`, `pharmacist`, and `admin`.

## Bootstrap the permanent administrator

Create the first admin out of band so public signup can never create an administrator:

1. In Firebase Console, create the administrator's Authentication account using an organization-controlled email, verify the email, and copy the Auth UID.
2. Create `registry/ADMIN-001` with `name`, `role: "admin"`, and `authEmail` matching that verified account. Do not publish the admin email in a public collection.
3. On a trusted admin workstation, install dependencies with `npm --prefix functions install` and configure Application Default Credentials for the correct Firebase project. Never put service-account credentials in this web project.
4. Run `node scripts/set-user-claims.js <auth-uid> ADMIN-001 admin`. The script checks the registry role and verified Auth email before it issues claims and writes `authUid`/`signedUp`.
5. Keep this account as a controlled break-glass/primary admin account, enable MFA in Firebase Authentication, and maintain a separate recovery procedure. Do not share its password. Provision a second trusted admin account through the same trusted process if the clinic needs continuity.

The registry ID must be an exact document ID. Restrict who can run the claim-provisioning script; anyone with project Admin SDK credentials can grant roles.

## Self-service enrollment for approved users

1. An admin creates the person's registry record in the Admin dashboard and enters their organization-approved email in **Recovery email**. The ID and role come from that admin-owned record.
2. The person opens Sign up, enters the same clinic ID and email, creates a password of at least 12 characters, and verifies the email through Firebase's verification email.
3. After verification, they return to the same app, choose **I've verified my email — finish setup**, and submit the same clinic ID.
4. `completeEnrollment` checks the verified Auth email against the pre-approved registry email, prevents admin enrollment, atomically claims the ID for that Auth UID, and assigns the registry role as custom claims. The user then signs in to the dashboard.

The browser cannot select a role or change the approved email. If an ID/email pair is wrong or already claimed, enrollment is denied. Admin accounts are never eligible for this public enrollment function.

## Deploy access rules

Review `firestore.rules`, then deploy the Firestore rules, Realtime Database rules, and callable functions to the intended project. From the project directory, install function dependencies with `npm --prefix functions install`, then deploy with `firebase deploy --project uni-clinic-ce45a --only firestore:rules,database,functions`. Confirm the Firebase CLI is authenticated to the intended project before deploying. The supplied rules fail closed for collections without an explicit match.

The callables `completeEnrollment`, `bookAppointment`, and `setAppointmentStatus` run with Admin SDK privileges. `bookAppointment` uses a Firestore transaction to validate the student's assignment, claim a slot exactly once, and create the appointment atomically. Enable Firebase App Check for the web app and enforce it on callable functions before production use; this repository does not include an App Check provider/site key.

If Realtime Database is enabled, deploy `database.rules.json` to Realtime Database > Rules as well. The current `firebase-config.js` does not specify `databaseURL`, so presence is disabled until that is configured.

Do not use live clinic data until the rules are deployed and tested in the Firebase Rules simulator with student, doctor, counsellor, pharmacist, admin, and unauthenticated identities.

## Sign-in and account recovery

Users sign in with their verified account email and password. The app reads role and clinic ID from server-issued Auth custom claims; browser storage is not an authorization source. Self-service signup is available only for admin-approved, non-admin registry IDs and matching verified emails. Password reset uses Firebase Auth and does not look up clinic IDs in a public registry.

The Firebase web API key in `firebase-config.js` is browser configuration, not a private credential. Restrict it in Google Cloud Console to the necessary APIs and approved web origins. Keep all Admin SDK credentials outside this static web app.

## Hosting security headers

The repository does not identify the hosting provider, so headers must be applied in the actual hosting configuration. Enforce HTTPS and HSTS; set a restrictive Content-Security-Policy with `frame-ancestors 'none'`, `object-src 'none'`, and only required Firebase and Google Fonts origins; set `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store` for authenticated application pages. Verify the deployed response headers in a browser or with the hosting provider's header inspector before launch.
