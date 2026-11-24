# University Clinic Firebase Setup

## Security prerequisites

This app now requires Firebase Authentication custom claims. The browser must never assign clinic IDs or roles. Do not restore the old permissive Firestore rules or browser signup flow.

Required Auth custom claims:

```json
{ "clinicId": "Student-2024118", "role": "student" }
```

Supported roles: `student`, `doctor`, `counsellor`, `pharmacist`, and `admin`.

## Provision accounts

1. In Firebase Console, create the Authentication user using an administrator-verified email address.
2. Create the matching `registry/{clinicId}` Firestore document through a trusted admin process. Store only necessary fields, including `name`, `role`, the account email in `authEmail` (or `recoveryEmail` for existing records), and, for students, `assignedDoctor` and `assignedCounsellor`.
3. On a trusted administrator workstation, install the function dependencies with `npm --prefix functions install` and configure Application Default Credentials for the correct Firebase project. Never put a service-account key in this web project or publish it.
4. Run `node scripts/set-user-claims.js <auth-uid> <clinic-id> <role>`. The script checks that the registry role and Auth email match before it issues the claims.
5. Have the user sign out and back in so Firebase refreshes the ID token.

The registry ID must be an exact document ID. For the initial administrator, seed the registry document and Auth account through a trusted process before issuing the admin claim. Restrict who can run the claim-provisioning script; anyone with project Admin SDK credentials can grant roles.

## Deploy access rules

Review `firestore.rules`, then deploy the Firestore rules, Realtime Database rules, and booking function to the intended project. From the project directory, install function dependencies with `npm --prefix functions install`, then deploy with `firebase deploy --project uni-clinic-ce45a --only firestore:rules,database,functions`. Confirm the Firebase CLI is authenticated to the intended project before deploying. The supplied rules fail closed for collections without an explicit match.

The callable `bookAppointment` function uses a Firestore transaction to validate the student's assignment, claim the slot exactly once, and create the appointment atomically. Enable Firebase App Check for the web app and enforce it on callable functions before production use; the callable currently requires a valid signed-in student claim but does not enforce App Check because no site key/provider configuration is supplied.

If Realtime Database is enabled, deploy `database.rules.json` to Realtime Database > Rules as well. The current `firebase-config.js` does not specify `databaseURL`, so presence is disabled until that is configured.

Do not use live clinic data until the rules are deployed and tested in the Firebase Rules simulator with student, doctor, counsellor, pharmacist, admin, and unauthenticated identities.

## Sign-in and account recovery

Users sign in with their provisioned email and password. The app reads role and clinic ID from verified Auth custom claims; browser storage is used only for display convenience and is not an authorization source. Self-service signup is intentionally disabled. Password reset uses Firebase Auth and does not look up clinic IDs in a public registry.

The Firebase web API key in `firebase-config.js` is browser configuration, not a private credential. Restrict it in Google Cloud Console to the necessary APIs and approved web origins. Keep all Admin SDK credentials outside this static web app.

## Hosting security headers

The repository does not identify the hosting provider, so headers must be applied in the actual hosting configuration. Enforce HTTPS and HSTS; set a restrictive Content-Security-Policy with `frame-ancestors 'none'`, `object-src 'none'`, and only required Firebase and Google Fonts origins; set `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store` for authenticated application pages. Verify the deployed response headers in a browser or with the hosting provider's header inspector before launch.
