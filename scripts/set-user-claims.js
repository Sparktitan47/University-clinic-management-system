// Run only from a trusted administrator workstation with Application Default
// Credentials for the Firebase project configured in GOOGLE_APPLICATION_CREDENTIALS.
// Usage: node scripts/set-user-claims.js <auth-uid> <clinic-id> <role>
const path = require("path");
const admin = require(require.resolve("firebase-admin", { paths: [path.join(__dirname, "../functions")] }));

const [uid, clinicId, role] = process.argv.slice(2);
const roles = new Set(["student", "doctor", "counsellor", "pharmacist", "admin"]);
const idPatterns = {
  student: /^Student-[A-Za-z0-9]+$/,
  doctor: /^DOC-[A-Za-z0-9]+$/,
  counsellor: /^COUN-[A-Za-z0-9]+$/,
  pharmacist: /^PHR-[A-Za-z0-9]+$/,
  admin: /^ADMIN-001$/,
};
if (!uid || !clinicId || !roles.has(role) || !idPatterns[role].test(clinicId)) {
  console.error("Usage: node scripts/set-user-claims.js <auth-uid> <clinic-id> <role>");
  process.exit(2);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });
async function provision() {
  const authUser = await admin.auth().getUser(uid);
  if (!authUser.emailVerified) throw new Error("Verify the Auth account email before provisioning.");
  const registryDoc = await admin.firestore().collection("registry").doc(clinicId).get();
  if (!registryDoc.exists || String(registryDoc.get("role") || "").toLowerCase() !== role) {
    throw new Error("Registry record is missing or its role does not match.");
  }
  const expectedEmail = String(registryDoc.get("authEmail") || registryDoc.get("recoveryEmail") || "").trim().toLowerCase();
  if (!expectedEmail || expectedEmail !== String(authUser.email || "").trim().toLowerCase()) {
    throw new Error("Auth user email does not match the administrator-provisioned registry email.");
  }
  const existing = authUser.customClaims || {};
  await admin.auth().setCustomUserClaims(uid, { ...existing, clinicId, role });
  await admin.firestore().collection("registry").doc(clinicId).set({
    authUid: uid, authEmail: expectedEmail, signedUp: true,
  }, { merge: true });
  await admin.firestore().collection("directory").doc(clinicId).set({
    name: String(registryDoc.get("name") || clinicId), role,
  }, { merge: true });
  console.log(`Provisioned clinic claims for ${clinicId} (${role}). User must sign out and back in.`);
}

provision().catch(error => {
  console.error(`Provisioning failed: ${error.code || "error"}`);
  process.exitCode = 1;
});
