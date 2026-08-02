# University Clinic Firebase Setup

## 1. Enable Authentication

In Firebase Console:

1. Open your project.
2. Go to Authentication.
3. Open Sign-in method.
4. Enable Email/Password.

Users still type their university or staff ID. The app converts that ID into an internal Firebase Auth email.

## 2. Create Recognised IDs

Open Firestore Database and create this collection:

```txt
registry
```

Each recognised student or staff member needs one document. The document ID must exactly match the ID they type on the login page.

Student example:

```txt
Collection: registry
Document ID: Student-2024118

name: Azeez
role: student
signedUp: false
assignedDoctor: DOC-001
assignedCounsellor: COUN-001
```

Doctor example:

```txt
Collection: registry
Document ID: DOC-001

name: Dr Musa
role: doctor
signedUp: false
```

Counsellor example:

```txt
Collection: registry
Document ID: COUN-001

name: Mrs Ade
role: counsellor
signedUp: false
```

Pharmacist example:

```txt
Collection: registry
Document ID: PHR-001

name: Pharm Grace
role: pharmacist
signedUp: false
```

Admin example:

```txt
Collection: registry
Document ID: ADMIN-001

name: Clinic Admin
role: admin
signedUp: false
```

After an ID is added, that person should use Sign up once to create their private password. The app then changes `signedUp` to `true`.

## 3. Use the Admin Dashboard

After `ADMIN-001` signs up and logs in, the app opens:

```txt
admin-dashboard.html
```

The admin can:

- Add recognised student and staff IDs.
- Assign each student to a doctor and counsellor.
- View submitted issue reports.

## 4. Test Flow

1. Add `ADMIN-001` in Firestore.
2. Sign up as `ADMIN-001`.
3. In the admin dashboard, add:
   - at least one student
   - at least one doctor
   - at least one counsellor
   - at least one pharmacist
4. Assign the student to a doctor and counsellor.
5. Sign up as the doctor and set availability.
6. Sign up as the counsellor and set availability.
7. Sign up as the pharmacist and add medications.
8. Sign up as the student.
9. Test student messages, appointment requests, pharmacy view, and issue reports.

## 5. Dashboard Files

Role redirects are controlled in `core.js`:

```txt
student     -> student-dashboard.html
doctor      -> doctor-dashboard.html
pharmacist  -> pharmacist-dashboard.html
counsellor  -> counsellor-dashboard.html
admin       -> admin-dashboard.html
```

## 6. Firestore Collections Used

```txt
registry
chats
appointments
availability
pharmacy
reports
```

## 7. Development Rules

The app needs a known registry ID to be readable before sign-in, and it needs
signed-in users to create chat messages and update the registry during signup.

Copy the contents of `firestore.rules` into Firebase Console > Firestore
Database > Rules, then click **Publish**. This restores the Admin dashboard's
ability to add, update, assign, and remove IDs and allows the live chat to save
both its conversation and message together.

This rule set is a functional baseline for this browser-only prototype. Before
using real clinic data, move authorisation to server-side functions and use
Firebase custom claims to enforce per-user, per-role access.
