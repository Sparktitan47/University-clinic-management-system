// ============================================================
//  FIREBASE CONFIG  —  fill in YOUR project's values here
//  See docs/SETUP_GUIDE.md for step-by-step instructions
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBavHaEVjN_iOWTYjNBrTZV1mettu-seoM",
  authDomain: "uni-clinic-ce45a.firebaseapp.com",
  projectId: "uni-clinic-ce45a",
  storageBucket: "uni-clinic-ce45a.firebasestorage.app",
  messagingSenderId: "916229738053",
  appId: "1:916229738053:web:3bb4cdbfd1c0db0eca9d2c"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.firestore();
// Remove any disk cache created by earlier versions, then use Firestore's
// default in-memory cache only. The guard awaits this before dashboard reads.
const clinicCacheCleanup = db.clearPersistence().catch(() => {});
let rtdb = null;
if (firebaseConfig.databaseURL) {
  try {
    rtdb = firebase.database();
  } catch (err) {
    console.warn("Realtime Database is not configured; presence features are disabled.");
  }
}

// Do not enable persistent browser caching for clinic conversations or records.
