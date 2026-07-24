// ============================================================
//  STUDENT.JS  —  student-dashboard.html
// ============================================================
initTheme();
let ME = {};

guardRoute("student").then(async user => {
  ME = user;
  document.getElementById("userName").textContent  = user.name;
  document.getElementById("userId").textContent    = user.id;
  document.getElementById("heroName").textContent  = user.name.split(" ")[0];
  document.getElementById("heroId").textContent    = user.id;
  attachThemeToggle("themeBtn");

  // Load assigned staff from registry
  const reg = await lookupRegistry(user.id);
  ME.assignedDoctor     = reg?.assignedDoctor     || null;
  ME.assignedCounsellor = reg?.assignedCounsellor || null;
  ME.canMessageAny      = reg?.canMessageAnyDoctor || false;

  await loadDoctorInfo();
  await loadCounsellorInfo();
  await loadPharmacy();
  await renderEmergencyContacts();
  watchReportNotifications();
  await loadMyAppointments();
});

// ── Navigation ────────────────────────────────────────────────
document.querySelectorAll("[data-section]").forEach(el => {
  el.addEventListener("click", () => {
    const target = el.dataset.section;
    showSection(target);
    closeDrawer();
  });
});

function showSection(name) {
  document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll("[data-section]").forEach(el => el.classList.remove("active"));
  document.getElementById(`sec-${name}`)?.classList.add("active");
  document.querySelectorAll(`[data-section="${name}"]`).forEach(el => el.classList.add("active"));
}

// ── Hamburger drawer ──────────────────────────────────────────
document.getElementById("hamburgerBtn").addEventListener("click", openDrawer);
document.getElementById("drawerOverlay").addEventListener("click", closeDrawer);
document.getElementById("drawerClose").addEventListener("click", closeDrawer);

function openDrawer() {
  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawerOverlay").classList.add("open");
}
function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawerOverlay").classList.remove("open");
}

async function renderEmergencyContacts() {
  const list = document.getElementById("emergencyList");
  if (!list) return;
  const contacts = await loadEmergencyContacts();
  list.innerHTML = "";
  contacts.forEach(contact => {
    const item = document.createElement("div");
    item.className = "appt-item";
    item.innerHTML = `<div class="appt-item-info"><strong>${escHtml(contact.name || "")}</strong><span>${escHtml(contact.details || "")}</span></div>`;
    list.appendChild(item);
  });
}

// Sign out
document.querySelectorAll(".sign-out-btn").forEach(b => b.addEventListener("click", goOfflineAndSignOut));

document.getElementById("issueForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const subject = document.getElementById("issueSubject").value.trim();
  const body = document.getElementById("issueBody").value.trim();
  if (!subject || !body) return;
  await db.collection("reports").add({
    subject,
    body,
    studentId: ME.id,
    studentName: ME.name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    status: "new",
    studentSortedSeen: true,
  });
  e.target.reset();
  toast("Report submitted.", "success");
});

let reportNoticeUnsub = null;
let unreadSortedReports = [];

function watchReportNotifications() {
  if (reportNoticeUnsub) reportNoticeUnsub();
  reportNoticeUnsub = db.collection("reports").where("studentId", "==", ME.id).onSnapshot(snap => {
    unreadSortedReports = [];
    snap.forEach(doc => {
      const data = doc.data();
      if (data.status === "sorted" && data.studentSortedSeen === false) {
        unreadSortedReports.push({ id: doc.id, ...data });
      }
    });
    unreadSortedReports.sort((a, b) => tsMillis(b.sortedAt) - tsMillis(a.sortedAt));
    renderReportNotifications();
  });
}

function renderReportNotifications() {
  const dot = document.getElementById("studentReportDot");
  const notice = document.getElementById("sortedReportNotice");
  dot?.classList.toggle("hidden", unreadSortedReports.length === 0);
  if (!notice) return;
  notice.classList.toggle("hidden", unreadSortedReports.length === 0);
  notice.innerHTML = "";
  unreadSortedReports.forEach(report => {
    const item = document.createElement("div");
    item.className = "report-status-item";
    item.innerHTML = `
      <div>
        <strong>${escHtml(report.subject || "Your report")}</strong>
        <span>Your complaint has been sorted by the clinic admin.</span>
      </div>
      <button class="btn btn-sm btn-primary" type="button" data-check-report="${escHtml(report.id)}">Checked</button>`;
    notice.appendChild(item);
  });
}

document.getElementById("sortedReportNotice")?.addEventListener("click", async e => {
  const reportId = e.target.closest("[data-check-report]")?.dataset.checkReport;
  if (!reportId) return;
  await db.collection("reports").doc(reportId).set({
    studentSortedSeen: true,
    studentSeenAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  toast("Notification checked.", "success");
});

// ── Doctor chat ───────────────────────────────────────────────
let docChatUnsub = null;
let DOC_ID = null;

async function loadDoctorInfo() {
  DOC_ID = ME.assignedDoctor;
  if (!DOC_ID) {
    document.getElementById("docChatHeader").innerHTML = `<p style="padding:16px;color:var(--text-2)">No doctor assigned yet. Check back later or contact the clinic admin.</p>`;
    return;
  }
  const docReg = await lookupRegistry(DOC_ID);
  if (!docReg) return;

  document.getElementById("docName").textContent = docReg.name || DOC_ID;
  document.getElementById("docId").textContent   = DOC_ID;
  const dotEl = document.getElementById("docDot");
  if (dotEl) watchPresence(DOC_ID, dotEl);
  initDocChat();
  loadDocSlots();
}

function initDocChat() {
  const threadId = [ME.id, DOC_ID].sort().join("__");
  const msgsRef  = db.collection("chats").doc(threadId).collection("messages").orderBy("ts");
  if (docChatUnsub) docChatUnsub();
  docChatUnsub = msgsRef.onSnapshot(snap => {
    const box = document.getElementById("docMessages");
    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        const d  = change.doc.data();
        box.appendChild(buildBubble(d.senderId, d.text, d.ts, ME.id));
        box.scrollTop = box.scrollHeight;
      }
    });
  });
}

async function sendDocMessage() {
  const textarea = document.getElementById("docInput");
  const text = textarea.value.trim();
  if (!text || !DOC_ID) return;
  textarea.value = "";
  textarea.style.height = "auto";
  const threadId = [ME.id, DOC_ID].sort().join("__");
  await db.collection("chats").doc(threadId).collection("messages").add({
    text, senderId: ME.id, senderName: ME.name,
    ts: firebase.firestore.FieldValue.serverTimestamp(),
  });
  // Update thread metadata so doctor sees it in sidebar
  await db.collection("chats").doc(threadId).set({
    participants: [ME.id, DOC_ID],
    lastMessage: text,
    lastTs: firebase.firestore.FieldValue.serverTimestamp(),
    [`unread_${DOC_ID}`]: firebase.firestore.FieldValue.increment(1),
  }, { merge: true });
}

document.getElementById("docSendBtn").addEventListener("click", sendDocMessage);
document.getElementById("docInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendDocMessage(); }
});
autoGrow(document.getElementById("docInput"));

// ── Doc appointment slots ─────────────────────────────────────
async function loadDocSlots() {
  if (!DOC_ID) return;
  const slotSnap = await db.collection("availability").doc(DOC_ID).get();
  const slots    = slotSnap.data()?.slots || [];
  const wrap     = document.getElementById("docSlots");
  wrap.innerHTML = "";
  if (!slots.length) { wrap.innerHTML = `<p style="color:var(--text-2);font-size:.85rem">No slots published yet.</p>`; return; }
  slots.forEach(slot => {
    const btn = document.createElement("button");
    btn.className = `slot-btn${slot.taken ? " taken" : ""}`;
    btn.textContent = slot.label;
    btn.disabled = slot.taken;
    if (!slot.taken) btn.addEventListener("click", () => openBookingModal("doctor", DOC_ID, slot));
    wrap.appendChild(btn);
  });
}

// ── Counsellor chat ───────────────────────────────────────────
let counChatUnsub = null;
let COUN_ID = null;

async function loadCounsellorInfo() {
  COUN_ID = ME.assignedCounsellor;
  if (!COUN_ID) {
    document.getElementById("counChatHeader").innerHTML = `<p style="padding:16px;color:var(--text-2)">No counsellor assigned yet.</p>`;
    return;
  }
  const reg = await lookupRegistry(COUN_ID);
  if (!reg) return;
  document.getElementById("counName").textContent = reg.name || COUN_ID;
  document.getElementById("counId").textContent   = COUN_ID;
  const dotEl = document.getElementById("counDot");
  if (dotEl) watchPresence(COUN_ID, dotEl);
  initCounChat();
  loadCounSlots();
}

function initCounChat() {
  const threadId = [ME.id, COUN_ID].sort().join("__");
  const msgsRef  = db.collection("chats").doc(threadId).collection("messages").orderBy("ts");
  if (counChatUnsub) counChatUnsub();
  counChatUnsub = msgsRef.onSnapshot(snap => {
    const box = document.getElementById("counMessages");
    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        const d = change.doc.data();
        box.appendChild(buildBubble(d.senderId, d.text, d.ts, ME.id));
        box.scrollTop = box.scrollHeight;
      }
    });
  });
}

async function sendCounMessage() {
  const textarea = document.getElementById("counInput");
  const text = textarea.value.trim();
  if (!text || !COUN_ID) return;
  textarea.value = "";
  textarea.style.height = "auto";
  const threadId = [ME.id, COUN_ID].sort().join("__");
  await db.collection("chats").doc(threadId).collection("messages").add({
    text, senderId: ME.id, senderName: ME.name,
    ts: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection("chats").doc(threadId).set({
    participants: [ME.id, COUN_ID],
    lastMessage: text,
    lastTs: firebase.firestore.FieldValue.serverTimestamp(),
    [`unread_${COUN_ID}`]: firebase.firestore.FieldValue.increment(1),
  }, { merge: true });
}

document.getElementById("counSendBtn").addEventListener("click", sendCounMessage);
document.getElementById("counInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCounMessage(); }
});
autoGrow(document.getElementById("counInput"));

async function loadCounSlots() {
  if (!COUN_ID) return;
  const slotSnap = await db.collection("availability").doc(COUN_ID).get();
  const slots    = slotSnap.data()?.slots || [];
  const wrap     = document.getElementById("counSlots");
  wrap.innerHTML = "";
  if (!slots.length) { wrap.innerHTML = `<p style="color:var(--text-2);font-size:.85rem">No slots published yet.</p>`; return; }
  slots.forEach(slot => {
    const btn = document.createElement("button");
    btn.className = `slot-btn${slot.taken ? " taken" : ""}`;
    btn.textContent = slot.label;
    btn.disabled = slot.taken;
    if (!slot.taken) btn.addEventListener("click", () => openBookingModal("counsellor", COUN_ID, slot));
    wrap.appendChild(btn);
  });
}

// ── Booking modal ─────────────────────────────────────────────
let pendingBooking = {};

function openBookingModal(type, staffId, slot) {
  pendingBooking = { type, staffId, slot };
  document.getElementById("bookingSlotLabel").textContent = slot.label;
  openModal("bookingModal");
}

document.getElementById("bookingForm").addEventListener("submit", async e => {
  e.preventDefault();
  const reason = document.getElementById("bookingReason").value.trim();
  if (!reason) return;
  const { type, staffId, slot } = pendingBooking;
  const apptRef = db.collection("appointments").doc();
  await apptRef.set({
    id:         apptRef.id,
    studentId:  ME.id,
    studentName:ME.name,
    staffId,
    staffType:  type,
    slot:       slot.label,
    slotId:     slot.id,
    reason,
    status:     "pending",
    createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
  });
  // Mark slot as taken
  const avSnap = await db.collection("availability").doc(staffId).get();
  const slots  = avSnap.data()?.slots || [];
  const updated = slots.map(s => s.id === slot.id ? { ...s, taken: true } : s);
  await db.collection("availability").doc(staffId).update({ slots: updated });

  toast("Appointment booked!", "success");
  closeModal("bookingModal");
  document.getElementById("bookingReason").value = "";
  type === "doctor" ? loadDocSlots() : loadCounSlots();
  loadMyAppointments();
});

// ── My appointments ───────────────────────────────────────────
async function loadMyAppointments() {
  const snap = await db.collection("appointments").where("studentId", "==", ME.id).get();
  const list = document.getElementById("myApptList");
  list.innerHTML = "";
  if (snap.empty) { list.innerHTML = `<p style="color:var(--text-2);font-size:.85rem">No appointments yet.</p>`; return; }
  const docs = snap.docs.sort((a, b) => tsMillis(b.data().createdAt) - tsMillis(a.data().createdAt));
  docs.forEach(doc => {
    const d = doc.data();
    const item = document.createElement("div");
    item.className = "appt-item";
    item.innerHTML = `
      <div class="appt-item-info">
        <strong>${d.slot}</strong>
        <span>${d.staffId} - ${d.reason}</span>
      </div>
      <span class="badge badge-${d.status === "confirmed" ? "green" : d.status === "cancelled" ? "red" : "amber"}">${d.status}</span>`;
    list.appendChild(item);
  });
}

// ── Pharmacy ──────────────────────────────────────────────────
async function loadPharmacy() {
  const snap = await db.collection("pharmacy").orderBy("name").get();
  const grid = document.getElementById("pharmGrid");
  grid.innerHTML = "";
  if (snap.empty) { grid.innerHTML = `<p style="color:var(--text-2)">No medications listed yet.</p>`; return; }
  snap.forEach(doc => {
    const d = doc.data();
    const pct = Math.min(100, Math.round((d.qty / (d.maxQty || 100)) * 100));
    const card = document.createElement("div");
    card.className = "card drug-card";
    card.innerHTML = `
      <div class="drug-name">${d.name}</div>
      <div class="drug-type">${d.category || "Medication"}</div>
      <span class="badge badge-${d.available ? "green" : "red"}">${d.available ? "In stock" : "Out of stock"}</span>
      ${d.available ? `<div class="drug-qty">${d.qty} ${d.unit || "units"} remaining</div>` : ""}`;
    grid.appendChild(card);
  });
}

// ── Helpers ───────────────────────────────────────────────────
function buildBubble(senderId, text, ts, myId) {
  const isMine = senderId === myId;
  const row    = document.createElement("div");
  row.className = `msg-row ${isMine ? "sent" : "received"}`;
  row.innerHTML = `
    <div class="msg-bubble">${escHtml(text)}</div>
    <span class="msg-time">${fmtTime(ts)}</span>`;
  return row;
}

function autoGrow(el) {
  el.addEventListener("input", () => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  });
}

function escHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
}

function tsMillis(ts) {
  return ts?.toMillis ? ts.toMillis() : 0;
}

// Start on home
showSection("home");
