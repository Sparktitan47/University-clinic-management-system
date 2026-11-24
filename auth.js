// ============================================================
//  AUTH.JS - login.html logic
// ============================================================
initTheme();
attachThemeToggle("themeToggle");

// If session is still active, skip straight to the dashboard.
auth.onAuthStateChanged(async user => {
  if (user) {
    const claims = (await user.getIdTokenResult().catch(() => ({ claims: {} }))).claims;
    const role = String(claims.role || "").trim().toLowerCase();
    const id = String(claims.clinicId || "");
    if (id && ["student", "doctor", "counsellor", "pharmacist", "admin"].includes(role)) {
      window.location.href = dashboardForRole(role);
    }
  }
});

function showAuthForm(name) {
  document.querySelectorAll(".auth-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
  document.getElementById(`${name}Form`)?.classList.add("active");
}

// Tab switching
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const form = document.getElementById(`${tab.dataset.tab}Form`);
    if (!form) return;

    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
    tab.classList.add("active");
    form.classList.add("active");
  });
});

function setErr(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg || "";
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = busy;
  btn.innerHTML = busy ? '<span class="spinner"></span>' : label;
}

// LOGIN
document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  setErr("loginIdError", "");
  setErr("loginPasswordError", "");

  const email = document.getElementById("loginId").value.trim().toLowerCase();
  const pw = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmit");

  if (!isUsableRecoveryEmail(email)) return setErr("loginIdError", "Enter the email address assigned to your clinic account.");
  if (!pw) return setErr("loginPasswordError", "Enter your password.");

  setBusy(btn, true);
  try {
    clearClinicSession();
    await auth.signInWithEmailAndPassword(email, pw);
    const claims = (await auth.currentUser.getIdTokenResult(true)).claims;
    const id = String(claims.clinicId || "");
    const role = String(claims.role || "").trim().toLowerCase();
    if (!id || !["student", "doctor", "counsellor", "pharmacist", "admin"].includes(role)) {
      await auth.signOut();
      throw new Error("This account has not been provisioned for clinic access.");
    }
    window.location.href = dashboardForRole(role);
  } catch (err) {
    // Keep the underlying Firebase error visible for support and deployment
    // diagnostics. The UI message below remains safe for end users.
    console.error("Clinic login failed", {
      code: err?.code || "unknown",
    });
    if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
      setErr("loginPasswordError", "Incorrect email or password.");
    } else if (err.code === "auth/operation-not-allowed") {
      setErr("loginIdError", "Password sign-in is not enabled. Ask the clinic admin to enable Email/Password in Firebase Authentication.");
    } else if (err.code === "auth/user-not-found") {
      setErr("loginIdError", "No clinic account is available for these credentials. Contact the clinic administrator.");
    } else if (err.code === "permission-denied" || err.code === "firestore/permission-denied") {
      setErr("loginIdError", "This account is not provisioned for clinic access. Contact the clinic administrator.");
    } else if (err.code === "unavailable" || err.code === "firestore/unavailable") {
      setErr("loginIdError", "Cannot reach the clinic database. Check your internet connection and try again.");
    } else if (err.code === "auth/too-many-requests") {
      setErr("loginPasswordError", "Too many attempts - try again shortly.");
    } else {
      setErr("loginIdError", "Something went wrong. Please try again.");
    }
  } finally {
    setBusy(btn, false, "Log in");
  }
});

document.getElementById("forgotPasswordLink")?.addEventListener("click", () => {
  document.getElementById("forgotId").value = document.getElementById("loginId").value.trim();
  setErr("forgotIdError", "");
  showAuthForm("forgot");
});

document.getElementById("backToLoginFromForgot")?.addEventListener("click", () => {
  setErr("forgotIdError", "");
  showAuthForm("login");
});

document.getElementById("forgotForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("forgotId").value.trim().toLowerCase();
  if (!isUsableRecoveryEmail(email)) return setErr("forgotIdError", "Enter your account email address.");
  const submitBtn = document.getElementById("forgotSubmit");
  setBusy(submitBtn, true);
  try {
    await auth.sendPasswordResetEmail(email);
    toast("If the account is eligible, a password reset email will be sent.", "success", 7000);
    showAuthForm("login");
  } catch (err) {
    if (err.code === "auth/too-many-requests") setErr("forgotIdError", "Too many attempts. Please wait and try again.");
    else setErr("forgotIdError", "Could not send the reset email. Contact the clinic administrator.");
  } finally { setBusy(submitBtn, false, "Send recovery email"); }
});

document.getElementById("signupForm").addEventListener("submit", async e => {
  e.preventDefault();
  setErr("signupIdError", "Self-service signup is disabled. Ask the clinic administrator to provision your account.");
  setErr("signupPasswordError", "Account roles and IDs must be assigned by the administrator.");
});
