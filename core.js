// ============================================================
//  CORE.JS  — shared helpers loaded by every page
// ============================================================

// ── Role / ID system ────────────────────────────────────────
const ADMIN_ID = "ADMIN-001";
const ROLE_PREFIXES = {
  "Student-":  "student",
  "DOC-":      "doctor",
  "PHR-":      "pharmacist",
  "COUN-":     "counsellor",
};

function detectRole(rawId) {
  const id = (rawId || "").trim();
  if (id === ADMIN_ID) return "admin";
  for (const [prefix, role] of Object.entries(ROLE_PREFIXES)) {
    if (id.startsWith(prefix)) return role;
  }
  return null;
}

function isValidIdFormat(rawId) {
  const id = (rawId || "").trim();
  if (id === ADMIN_ID) return true;
  return Object.keys(ROLE_PREFIXES).some(prefix => {
    if (!id.startsWith(prefix)) return false;
    const suffix = id.slice(prefix.length);
    return /^[A-Za-z0-9]+$/.test(suffix) && suffix.length > 0;
  });
}

// Firebase Auth needs an email internally; users never see this
function idToEmail(rawId) {
  return `${rawId.trim().toLowerCase()}@clinic.local`;
}

function dashboardForRole(role) {
  const key = String(role || "").trim().toLowerCase();
  return {
    student:     "student-dashboard.html",
    doctor:      "doctor-dashboard.html",
    pharmacist:  "pharmacist-dashboard.html",
    counsellor:  "counsellor-dashboard.html",
    admin:       "admin-dashboard.html",
  }[key] || "login.html";
}

function emailToClinicId(email = "") {
  const suffix = "@clinic.local";
  const value = String(email || "").trim().toLowerCase();
  if (!value.endsWith(suffix)) return "";
  return canonicalClinicId(value.slice(0, -suffix.length));
}

function isUsableRecoveryEmail(email = "") {
  const value = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !value.endsWith("@clinic.local");
}

async function lookupRegistryByAuthEmail(email = "") {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return null;
  const snap = await db.collection("registry").where("authEmail", "==", value).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

function canonicalClinicId(rawId = "") {
  const id = String(rawId || "").trim();
  const lower = id.toLowerCase();
  if (lower === ADMIN_ID.toLowerCase()) return ADMIN_ID;
  const prefixMap = {
    "student-": "Student-",
    "doc-": "DOC-",
    "phr-": "PHR-",
    "coun-": "COUN-",
  };
  for (const [lowerPrefix, canonicalPrefix] of Object.entries(prefixMap)) {
    if (lower.startsWith(lowerPrefix)) return canonicalPrefix + id.slice(lowerPrefix.length);
  }
  return id;
}

function clearClinicSession() {
  localStorage.removeItem("clinic-id");
  localStorage.removeItem("clinic-role");
  localStorage.removeItem("clinic-name");
}

// ── Registry lookup ──────────────────────────────────────────
async function lookupRegistry(rawId) {
  const doc = await db.collection("registry").doc(rawId.trim()).get();
  if (!doc.exists) return null;
  return { id: rawId.trim(), ...doc.data() };
}

// ── Route guard ──────────────────────────────────────────────
// Call at top of each dashboard page.
function guardRoute(requiredRole) {
  return new Promise((resolve, reject) => {
    auth.onAuthStateChanged(async user => {
      if (!user) { window.location.href = "login.html"; return reject(); }
      let id   = localStorage.getItem("clinic-id");
      let role = localStorage.getItem("clinic-role");
      const authId = emailToClinicId(user.email);
      if (!id && authId) id = authId;
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
        window.location.href = "login.html";
        return reject();
      }
      if (id && !role) {
        const entry = await lookupRegistry(id).catch(() => null);
        role = entry?.role || detectRole(id);
        if (role) localStorage.setItem("clinic-role", role);
        if (entry?.name) localStorage.setItem("clinic-name", entry.name);
      }
      role = String(role || "").trim().toLowerCase();
      requiredRole = String(requiredRole || "").trim().toLowerCase();
      if (!id || role !== requiredRole) {
        window.location.href = role ? dashboardForRole(role) : "login.html";
        return reject();
      }
      setupPresence(id);
      resolve({ id, role, name: localStorage.getItem("clinic-name") || id });
    });
  });
}

// ── Theme ────────────────────────────────────────────────────
function initTheme() {
  const t = localStorage.getItem("clinic-theme") || "light";
  document.documentElement.setAttribute("data-theme", t);
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("clinic-theme", next);
  // Update any moon/sun icons on the page
  document.querySelectorAll(".theme-icon").forEach(el => {
    el.textContent = next === "dark" ? "☀️" : "🌙";
  });
}

function attachThemeToggle(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const icon = btn.querySelector(".theme-icon") || btn;
  icon.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";
  btn.addEventListener("click", toggleTheme);
}

// ── Toast ────────────────────────────────────────────────────
function toast(message, type = "info", duration = 4000) {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = Object.assign(document.createElement("div"), { className: "toast-stack" });
    document.body.appendChild(stack);
  }
  const el = Object.assign(document.createElement("div"), {
    className: `toast ${type}`,
    textContent: message,
  });
  stack.appendChild(el);
  setTimeout(() => {
    el.style.cssText = "opacity:0;transform:translateX(16px);transition:all 250ms ease;";
    setTimeout(() => el.remove(), 260);
  }, duration);
}

// Shared submit-button state helper. Dashboard pages do not load auth.js,
// so this must live in the common script rather than only on the login page.
function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.idleLabel = label || btn.textContent.trim();
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    return;
  }
  btn.disabled = false;
  btn.textContent = label || btn.dataset.idleLabel || "Submit";
}

// ── Presence (Realtime Database) ─────────────────────────────
function setupPresence(userId) {
  if (!rtdb) return;
  const statusRef    = rtdb.ref(`/status/${userId}`);
  const connectedRef = rtdb.ref(".info/connected");
  connectedRef.on("value", snap => {
    if (!snap.val()) return;
    statusRef.onDisconnect().set({ state: "offline", ts: firebase.database.ServerValue.TIMESTAMP });
    statusRef.set({ state: "online", ts: firebase.database.ServerValue.TIMESTAMP });
  });
}

function watchPresence(userId, dotEl) {
  if (!rtdb || !dotEl) return;
  rtdb.ref(`/status/${userId}`).on("value", snap => {
    dotEl.classList.remove("online", "away");
    if (snap.val()?.state === "online") dotEl.classList.add("online");
  });
}

async function goOfflineAndSignOut() {
  const id = localStorage.getItem("clinic-id");
  if (id && rtdb) await rtdb.ref(`/status/${id}`).set({ state: "offline", ts: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  clearClinicSession();
  await auth.signOut();
  window.location.href = "login.html";
}

function clinicLogoMarkup() {
  return `
    <span class="clinic-logo" aria-hidden="true">
      <svg class="ui-icon" viewBox="0 0 24 24">
        <path d="M12 5v14"/>
        <path d="M5 12h14"/>
        <rect x="3.5" y="3.5" width="17" height="17" rx="5"/>
      </svg>
    </span>`;
}

async function loadEmergencyContacts() {
  const fallback = [
    { name: "Campus Clinic Front Desk", details: "Call your university clinic reception immediately." },
    { name: "Campus Security", details: "For urgent on-campus safety incidents." },
    { name: "Nearest Emergency Unit", details: "Use local emergency services for life-threatening situations." },
  ];
  const snap = await db.collection("siteSettings").doc("emergencyContacts").get().catch(() => null);
  const contacts = snap?.data()?.contacts;
  return Array.isArray(contacts) && contacts.length ? contacts : fallback;
}

// ── Time formatting ──────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Initials avatar ──────────────────────────────────────────
function initials(name = "") {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}

// ── Modal helpers ────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id)?.classList.add("hidden"); }
document.addEventListener("click", e => {
  if (e.target.classList.contains("modal-overlay")) e.target.classList.add("hidden");
  if (e.target.classList.contains("modal-close"))   e.target.closest(".modal-overlay")?.classList.add("hidden");
});
