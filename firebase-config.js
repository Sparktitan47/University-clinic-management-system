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
let rtdb = null;
if (firebaseConfig.databaseURL) {
  try {
    rtdb = firebase.database();
  } catch (err) {
    console.warn("Realtime Database is not configured yet. Presence features are disabled.", err);
  }
}

// Enable offline caching so the UI doesn't go blank on a slow network
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
