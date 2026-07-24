// ============================================================
//  DOCTOR.JS - doctor-dashboard.html and counsellor-dashboard.html
// ============================================================
initTheme();

let ME = {};
let activeThread = null;
let activeMsgUnsub = null;

const STAFF_ROLE = document.body.dataset.role || "doctor";
const STAFF_LABEL = STAFF_ROLE === "counsellor" ? "Counsellor" : "Doctor";

guardRoute(STAFF_ROLE).then(async user => {
  ME = user;
  document.getElementById("staffName").textContent = user.name;
  document.getElementById("staffId").textContent = user.id;
  document.getElementById("staffRoleLabel").textContent = STAFF_LABEL;
  attachThemeToggle("themeBtn");
  listenToConversations();
  listenToAppointments();
  loadAvailability();
});

document.querySelectorAll(".sign-out-btn").forEach(btn => btn.addEventListener("click", goOfflineAndSignOut));

function listenToConversations() {
  db.collection("chats")
    .where("participants", "array-contains", ME.id)
    .onSnapshot(snap => {
      const list = document.getElementById("convoList");
      list.innerHTML = "";
      const docs = snap.docs.sort((a, b) => tsMillis(b.data().lastTs) - tsMillis(a.data().lastTs));
      docs.forEach(doc => renderConvoItem(doc.id, doc.data()));
    });
}

function renderConvoItem(threadId, data) {
  const otherId = data.participants.find(p => p !== ME.id);
  const unreadKey = `unread_${ME.id}`;
  const unread = data[unreadKey] || 0;

  lookupRegistry(otherId).then(reg => {
    const name = reg?.name || otherId;
    const item = document.createElement("div");
    item.className = `convo-item${unread ? " unread" : ""}${activeThread === threadId ? " active" : ""}`;
    item.dataset.thread = threadId;
    item.dataset.other = otherId;
    item.innerHTML = `
      <div class="convo-avatar">${initials(name)}<span class="dot" id="dot-${otherId}"></span></div>
      <div class="convo-info">
        <div class="convo-name">${escHtml(name)}</div>
        <div class="convo-id mono">${escHtml(otherId)}</div>
        <div class="convo-preview">${escHtml(data.lastMessage || "")}</div>
      </div>
      <div class="convo-meta">
        <span class="convo-time">${fmtDate(data.lastTs)}</span>
        ${unread ? `<span class="unread-badge">${unread}</span>` : ""}
      </div>`;
    item.addEventListener("click", () => openThread(threadId, otherId, name));
    document.getElementById("convoList").appendChild(item);
    watchPresence(otherId, document.getElementById(`dot-${otherId}`));
  });
}

function openThread(threadId, otherId, otherName) {
  activeThread = threadId;
  document.querySelectorAll(".convo-item").forEach(el => el.classList.remove("active"));
  document.querySelector(`[data-thread="${threadId}"]`)?.classList.add("active");

  document.getElementById("chatEmpty").classList.add("hidden");
  document.getElementById("chatActive").classList.remove("hidden");
  document.getElementById("chatHeaderName").textContent = otherName;
  document.getElementById("chatHeaderId").textContent = otherId;
  document.getElementById("chatMessages").innerHTML = "";

  db.collection("chats").doc(threadId).update({ [`unread_${ME.id}`]: 0 }).catch(() => {});

  if (activeMsgUnsub) activeMsgUnsub();
  activeMsgUnsub = db.collection("chats").doc(threadId)
    .collection("messages").orderBy("ts")
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "added") {
          const data = change.doc.data();
          const box = document.getElementById("chatMessages");
          box.appendChild(buildBubble(data.senderId, data.text, data.ts, ME.id));
          box.scrollTop = box.scrollHeight;
        }
      });
    });
}

async function sendMessage() {
  const textarea = document.getElementById("chatInput");
  const text = textarea.value.trim();
  if (!text || !activeThread) return;
  textarea.value = "";
  textarea.style.height = "auto";

  const otherId = document.querySelector(`[data-thread="${activeThread}"]`)?.dataset.other;
  await db.collection("chats").doc(activeThread).collection("messages").add({
    text,
    senderId: ME.id,
    senderName: ME.name,
    ts: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection("chats").doc(activeThread).set({
    lastMessage: text,
    lastTs: firebase.firestore.FieldValue.serverTimestamp(),
    [`unread_${otherId}`]: firebase.firestore.FieldValue.increment(1),
  }, { merge: true });
}

document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("chatInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
autoGrow(document.getElementById("chatInput"));

document.getElementById("searchInput").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll(".convo-item").forEach(el => {
    const name = el.querySelector(".convo-name")?.textContent.toLowerCase() || "";
    const id = el.querySelector(".convo-id")?.textContent.toLowerCase() || "";
    el.style.display = name.includes(q) || id.includes(q) ? "" : "none";
  });
});

function listenToAppointments() {
  db.collection("appointments").where("staffId", "==", ME.id)
    .onSnapshot(snap => {
      const list = document.getElementById("apptList");
      list.innerHTML = "";
      if (snap.empty) {
        list.innerHTML = `<p class="text-2" style="font-size:.85rem;padding:8px 0">No appointments yet.</p>`;
        return;
      }
      const docs = snap.docs.sort((a, b) => tsMillis(b.data().createdAt) - tsMillis(a.data().createdAt));
      docs.forEach(doc => {
        const data = doc.data();
        const card = document.createElement("div");
        card.className = "appt-card";
        card.innerHTML = `
          <div class="appt-card-who">${escHtml(data.studentName || data.studentId)}</div>
          <div class="appt-card-when"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg> ${escHtml(data.slot || "")}</div>
          <div class="appt-card-reason"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.5-5A8 8 0 1 1 21 12Z"/></svg> ${escHtml(data.reason || "No reason given")}</div>
          <div class="appt-card-actions">
            <button class="btn btn-sm btn-primary" onclick="updateAppt('${doc.id}','confirmed')">Confirm</button>
            <button class="btn btn-sm btn-danger" onclick="updateAppt('${doc.id}','cancelled')">Cancel</button>
          </div>
          <div style="margin-top:6px">
            <span class="badge badge-${data.status === "confirmed" ? "green" : data.status === "cancelled" ? "red" : "amber"}">${escHtml(data.status || "pending")}</span>
          </div>`;
        list.appendChild(card);
      });
    });
}

async function updateAppt(id, status) {
  const ref = db.collection("appointments").doc(id);
  const snap = await ref.get();
  const data = snap.data() || {};
  await ref.update({ status });
  if (status === "cancelled" && data.staffId && data.slotId) {
    const avRef = db.collection("availability").doc(data.staffId);
    const avSnap = await avRef.get();
    const slots = avSnap.data()?.slots || [];
    await avRef.update({
      slots: slots.map(slot => slot.id === data.slotId ? { ...slot, taken: false } : slot),
    });
  }
  toast(`Appointment ${status}.`, status === "confirmed" ? "success" : "err");
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
let savedSlots = [];

async function loadAvailability() {
  const snap = await db.collection("availability").doc(ME.id).get();
  const data = snap.data() || {};
  savedSlots = data.slots || [];
  renderDays(data.days || []);
  document.getElementById("avStartTime").value = data.startTime || "09:00";
  document.getElementById("avEndTime").value = data.endTime || "17:00";
  document.getElementById("avDuration").value = data.duration || 30;
}

function renderDays(activeDays) {
  const wrap = document.getElementById("dayGrid");
  wrap.innerHTML = "";
  DAYS.forEach(day => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `day-toggle${activeDays.includes(day) ? " on" : ""}`;
    btn.textContent = day.slice(0, 3);
    btn.dataset.day = day;
    btn.addEventListener("click", () => btn.classList.toggle("on"));
    wrap.appendChild(btn);
  });
}

document.getElementById("saveAvailBtn").addEventListener("click", async () => {
  const days = [...document.querySelectorAll(".day-toggle.on")].map(btn => btn.dataset.day);
  const start = document.getElementById("avStartTime").value;
  const end = document.getElementById("avEndTime").value;
  const duration = parseInt(document.getElementById("avDuration").value) || 30;
  const slots = generateSlots(days, start, end, duration);

  await db.collection("availability").doc(ME.id).set({ days, startTime: start, endTime: end, duration, slots }, { merge: false });
  toast("Availability saved.", "success");
  savedSlots = slots;
});

function generateSlots(days, start, end, durationMins) {
  const slots = [];
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const endTotal = eh * 60 + em;
  days.forEach(day => {
    let t = sh * 60 + sm;
    while (t + durationMins <= endTotal) {
      const h1 = String(Math.floor(t / 60)).padStart(2, "0");
      const m1 = String(t % 60).padStart(2, "0");
      const t2 = t + durationMins;
      const h2 = String(Math.floor(t2 / 60)).padStart(2, "0");
      const m2 = String(t2 % 60).padStart(2, "0");
      const id = `${day}-${h1}${m1}`;
      const existing = savedSlots.find(slot => slot.id === id);
      slots.push({ id, day, label: `${day} ${h1}:${m1}-${h2}:${m2}`, taken: existing?.taken || false });
      t += durationMins;
    }
  });
  return slots;
}

function buildBubble(senderId, text, ts, myId) {
  const isMine = senderId === myId;
  const row = document.createElement("div");
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

function escHtml(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

function tsMillis(ts) {
  return ts?.toMillis ? ts.toMillis() : 0;
}
