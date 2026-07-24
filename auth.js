// ============================================================
//  AUTH.JS - login.html logic
// ============================================================
initTheme();
attachThemeToggle("themeToggle");

// If session is still active, skip straight to the dashboard.
auth.onAuthStateChanged(async user => {
  if (user) {
    const authId = emailToClinicId(user.email);
    let role = localStorage.getItem("clinic-role");
    let id = localStorage.getItem("clinic-id");
    if (!id && authId) {
      id = authId;
      localStorage.setItem("clinic-id", id);
    }
    if (!id && !authId) {
      const entry = await lookupRegistryByAuthEmail(user.email).catch(() => null);
      if (entry?.id) {
        id = entry.id;
        role = entry.role || detectRole(entry.id);
        localStorage.setItem("clinic-id", entry.id);
        if (role) localStorage.setItem("clinic-role", String(role).trim().toLowerCase());
        if (entry.name) localStorage.setItem("clinic-name", entry.name);
      }
    }
    if (id && authId && id.toLowerCase() !== authId.toLowerCase()) {
      clearClinicSession();
      await auth.signOut().catch(() => {});
      return;
    }
    if (!role && id) {
      const entry = await lookupRegistry(id).catch(() => null);
      role = entry?.role || detectRole(id);
      if (role) localStorage.setItem("clinic-role", String(role).trim().toLowerCase());
      if (entry?.name) localStorage.setItem("clinic-name", entry.name);
    }
    if (role) window.location.href = dashboardForRole(role);
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

  const rawId = canonicalClinicId(document.getElementById("loginId").value);
  const pw = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmit");

  if (!isValidIdFormat(rawId)) return setErr("loginIdError", "ID format not recognised - check the prefix.");
  if (!pw) return setErr("loginPasswordError", "Enter your password.");

  setBusy(btn, true);
  try {
    clearClinicSession();
    const entry = await lookupRegistry(rawId);
    if (!entry) {
      setErr("loginIdError", "ID not on file. Contact the clinic admin.");
      return;
    }
    const primaryEmail = String(entry.authEmail || "").trim().toLowerCase();
    try {
      await auth.signInWithEmailAndPassword(primaryEmail || idToEmail(rawId), pw);
    } catch (err) {
      if (primaryEmail && primaryEmail !== idToEmail(rawId)) {
        await auth.signInWithEmailAndPassword(idToEmail(rawId), pw);
      } else {
        throw err;
      }
    }
    await attachRecoveryEmailIfPossible(rawId, entry).catch(() => {});
    const role = String(entry.role || detectRole(rawId) || "").trim().toLowerCase();
    if (!entry.signedUp) {
      await db.collection("registry").doc(rawId).set({
        signedUp: true,
        signedUpAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {});
    }
    localStorage.setItem("clinic-id", rawId);
    localStorage.setItem("clinic-role", role);
    localStorage.setItem("clinic-name", entry.name || rawId);
    window.location.href = dashboardForRole(role);
  } catch (err) {
    if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
      setErr("loginPasswordError", "Incorrect password.");
    } else if (err.code === "auth/too-many-requests") {
      setErr("loginPasswordError", "Too many attempts - try again shortly.");
    } else {
      setErr("loginIdError", "Something went wrong. Please try again.");
    }
  } finally {
    setBusy(btn, false, "Log in");
  }
});

async function attachRecoveryEmailIfPossible(rawId, entry) {
  const user = auth.currentUser;
  const recoveryEmail = String(entry.recoveryEmail || "").trim().toLowerCase();
  if (!user || !isUsableRecoveryEmail(recoveryEmail) || isUsableRecoveryEmail(entry.authEmail)) return;
  if (emailToClinicId(user.email)) {
    await user.updateEmail(recoveryEmail);
    await db.collection("registry").doc(rawId).set({
      authEmail: recoveryEmail,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

// SIGN UP
let verifiedEntry = null;

// Step 1: verify ID exists in registry.
document.getElementById("verifyIdBtn").addEventListener("click", async () => {
  setErr("signupIdError", "");

  const rawId = canonicalClinicId(document.getElementById("signupId").value);
  const btn = document.getElementById("verifyIdBtn");

  if (!isValidIdFormat(rawId)) return setErr("signupIdError", "ID format not recognised - check the prefix.");

  setBusy(btn, true);
  try {
    const entry = await lookupRegistry(rawId);
    if (!entry) {
      setErr("signupIdError", "ID not on file. Ask the admin to register it first.");
      return;
    }
    if (entry.signedUp) {
      setErr("signupIdError", "This ID already has a password - use the Log in tab.");
      return;
    }

    verifiedEntry = entry;
    verifiedEntry.role = String(verifiedEntry.role || detectRole(rawId) || "").trim().toLowerCase();
    document.getElementById("registryName").textContent = entry.name || rawId;
    const savedRecoveryEmail = String(entry.recoveryEmail || entry.authEmail || "").trim().toLowerCase();
    if (isUsableRecoveryEmail(savedRecoveryEmail)) {
      document.getElementById("signupRecoveryEmail").value = savedRecoveryEmail;
    }
    document.getElementById("signupStep1").style.display = "none";
    document.getElementById("signupStep2").style.display = "block";
    document.getElementById("stepDot1").classList.add("done");
    document.getElementById("stepDot2").classList.add("active");
  } catch {
    setErr("signupIdError", "Could not verify ID right now - try again.");
  } finally {
    setBusy(btn, false, "Verify ID");
  }
});

document.getElementById("backToStep1").addEventListener("click", () => {
  verifiedEntry = null;
  document.getElementById("signupStep2").style.display = "none";
  document.getElementById("signupStep1").style.display = "block";
  document.getElementById("stepDot1").classList.remove("done");
  document.getElementById("stepDot2").classList.remove("active");
  document.getElementById("signupId").value = "";
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
  await handlePasswordResetRequest(false);
});

document.getElementById("contactAdminReset")?.addEventListener("click", async () => {
  await handlePasswordResetRequest(true);
});

async function handlePasswordResetRequest(forceAdmin) {
  setErr("forgotIdError", "");
  const rawId = canonicalClinicId(document.getElementById("forgotId").value);
  const submitBtn = document.getElementById("forgotSubmit");
  const adminBtn = document.getElementById("contactAdminReset");
  if (!isValidIdFormat(rawId)) return setErr("forgotIdError", "ID format not recognised - check the prefix.");

  setBusy(forceAdmin ? adminBtn : submitBtn, true);
  try {
    const entry = await lookupRegistry(rawId);
    if (!entry) return setErr("forgotIdError", "ID not on file. Contact the clinic admin.");
    const authEmail = String(entry.authEmail || "").trim().toLowerCase();
    const recoveryEmail = String(entry.recoveryEmail || "").trim().toLowerCase();
    const resetEmail = isUsableRecoveryEmail(authEmail) ? authEmail : recoveryEmail;
    if (!forceAdmin && isUsableRecoveryEmail(resetEmail)) {
      await auth.sendPasswordResetEmail(resetEmail);
      toast(`Password reset link sent to ${maskEmail(resetEmail)}. Check inbox or spam.`, "success", 7500);
      showAuthForm("login");
      return;
    }

    await db.collection("reports").add({
      subject: "Password reset request",
      body: `${entry.name || rawId} requested an admin password reset for ${rawId}.`,
      studentId: rawId,
      studentName: entry.name || rawId,
      type: "password-reset",
      status: "new",
      studentSortedSeen: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast("Admin reset request sent. The clinic admin will see it in Issue reports.", "success", 6500);
    showAuthForm("login");
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-email") {
      setErr("forgotIdError", "Firebase has no password account attached to that recovery email yet. Use Contact admin to reset this older account.");
    } else if (err.code === "auth/too-many-requests") {
      setErr("forgotIdError", "Too many reset attempts. Please wait a bit and try again.");
    } else {
      setErr("forgotIdError", "Could not send the reset email. Check Firebase Email/Password auth is enabled, then try again.");
    }
  } finally {
    setBusy(submitBtn, false, "Send recovery email");
    setBusy(adminBtn, false, "Contact admin to reset account");
  }
}

function maskEmail(email = "") {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return "your recovery email";
  return `${name.slice(0, 2)}${name.length > 2 ? "***" : ""}@${domain}`;
}

// Step 2: create password.
document.getElementById("signupForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!verifiedEntry) return;

  setErr("signupPasswordError", "");
  setErr("signupPasswordConfirmError", "");

  const pw = document.getElementById("signupPassword").value;
  const pwConf = document.getElementById("signupPasswordConfirm").value;
  const recoveryEmail = document.getElementById("signupRecoveryEmail").value.trim().toLowerCase();
  const btn = document.getElementById("signupSubmit");

  setErr("signupRecoveryEmailError", "");
  if (pw.length < 8) return setErr("signupPasswordError", "Use at least 8 characters.");
  if (pw !== pwConf) return setErr("signupPasswordConfirmError", "Passwords do not match.");
  if (!isUsableRecoveryEmail(recoveryEmail)) return setErr("signupRecoveryEmailError", "Enter a valid email you can access.");

  setBusy(btn, true);
  try {
    await auth.createUserWithEmailAndPassword(recoveryEmail, pw);
    await db.collection("registry").doc(verifiedEntry.id).update({
      authEmail: recoveryEmail,
      recoveryEmail,
      signedUp: true,
      signedUpAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    const role = String(verifiedEntry.role || detectRole(verifiedEntry.id) || "").trim().toLowerCase();
    localStorage.setItem("clinic-id", verifiedEntry.id);
    localStorage.setItem("clinic-role", role);
    localStorage.setItem("clinic-name", verifiedEntry.name || verifiedEntry.id);
    toast("Account created - welcome!", "success");
    setTimeout(() => window.location.href = dashboardForRole(role), 700);
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      setErr("signupRecoveryEmailError", "This recovery email already belongs to another account.");
    } else if (err.code === "auth/weak-password") {
      setErr("signupPasswordError", "Choose a stronger password.");
    } else {
      setErr("signupPasswordError", "Something went wrong. Please try again.");
    }
    setBusy(btn, false, "Create account & continue");
  }
});
