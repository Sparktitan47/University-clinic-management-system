// ============================================================
//  ADMIN.JS - admin-dashboard.html
// ============================================================
initTheme();
let doctors = [];
let counsellors = [];
let allRegistryUsers = [];
let emergencyContacts = [];

guardRoute("admin").then(user => {
  document.getElementById("adminName").textContent = user.name;
  attachThemeToggle("themeBtn");
  loadRegistry();
  loadReports();
  loadAdminEmergencyContacts();
});

document.querySelectorAll(".sign-out-btn").forEach(btn => btn.addEventListener("click", goOfflineAndSignOut));

document.querySelectorAll("[data-admin-section]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-admin-section]").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".admin-section").forEach(section => section.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`admin-${btn.dataset.adminSection}`).classList.add("active");
  });
});

function loadRegistry() {
  db.collection("registry").orderBy("role").onSnapshot(snap => {
    const users = [];
    snap.forEach(doc => {
      const data = doc.data();
      users.push({ id: doc.id, ...data, role: String(data.role || detectRole(doc.id) || "").trim().toLowerCase() });
    });
    allRegistryUsers = users;
    doctors = users.filter(u => u.role === "doctor");
    counsellors = users.filter(u => u.role === "counsellor");
    renderStats(users);
    renderRegistry(getFilteredRegistry());
    renderAssignmentOptions(users);
  }, err => {
    console.error("Unable to load the clinic registry", err);
    toast("Unable to load the registry. Check Firestore security rules and your connection.", "err", 7000);
  });
}

function renderStats(users) {
  document.getElementById("statStudents").textContent = users.filter(u => u.role === "student").length;
  document.getElementById("statDoctors").textContent = users.filter(u => u.role === "doctor").length;
  document.getElementById("statCounsellors").textContent = users.filter(u => u.role === "counsellor").length;
  document.getElementById("statPharmacists").textContent = users.filter(u => u.role === "pharmacist").length;
}

function renderRegistry(users) {
  const body = document.getElementById("registryRows");
  body.innerHTML = "";
  if (!users.length) {
    body.innerHTML = '<tr><td colspan="8" class="text-2">No matching accounts found.</td></tr>';
    return;
  }
  users.forEach(user => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="mono">${escHtml(user.id)}</td>
      <td>${escHtml(user.name || "")}</td>
      <td><span class="badge badge-blue">${escHtml(user.role || "")}</span></td>
      <td>${user.signedUp ? '<span class="badge badge-green">active account</span>' : '<span class="badge badge-amber">ID authorised</span>'}</td>
      <td class="mono">${escHtml(user.recoveryEmail || user.authEmail || "not set")}</td>
      <td class="mono">${escHtml(user.role === "student" ? (user.assignedDoctor || "unassigned") : "N/A")}</td>
      <td class="mono">${escHtml(user.role === "student" ? (user.assignedCounsellor || "unassigned") : "N/A")}</td>
      <td class="actions">
        <button class="btn btn-sm btn-ghost" data-reset-account="${escHtml(user.id)}">Reset</button>
        <button class="btn btn-sm btn-danger" data-delete-account="${escHtml(user.id)}">Delete</button>
      </td>
    `;
    body.appendChild(row);
  });
}

function getFilteredRegistry() {
  const query = (document.getElementById("accountSearch")?.value || "").trim().toLowerCase();
  if (!query) return allRegistryUsers;
  return allRegistryUsers.filter(user => user.id.toLowerCase().includes(query));
}

document.getElementById("accountSearch")?.addEventListener("input", () => {
  renderRegistry(getFilteredRegistry());
});

document.getElementById("registryRows")?.addEventListener("click", async e => {
  const action = e.target.closest("[data-reset-account], [data-delete-account]");
  if (!action) return;
  const resetId = action.dataset.resetAccount;
  const deleteId = action.dataset.deleteAccount;
  if (resetId === ADMIN_ID || deleteId === ADMIN_ID) {
    toast("The active admin registry ID cannot be reset or deleted here.", "err");
    return;
  }
  if (resetId) {
    try {
      await db.collection("registry").doc(resetId).set({
        signedUp: false,
        resetAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      toast("Signup status reset. Delete the matching Firebase Auth user before that person signs up again.", "success", 6500);
    } catch (err) {
      console.error("Could not reset registry account", err);
      toast("Could not reset this ID. Check Firestore security rules.", "err");
    }
  }
  if (deleteId && confirm(`Delete ${deleteId} from the clinic registry?`)) {
    try {
      await db.collection("registry").doc(deleteId).delete();
      toast("Registry ID deleted. Delete its Firebase Auth user too before reusing the same email.", "success", 6500);
    } catch (err) {
      console.error("Could not delete registry account", err);
      toast("Could not delete this ID. Check Firestore security rules.", "err");
    }
  }
});

function renderAssignmentOptions(users) {
  const studentSelect = document.getElementById("assignStudent");
  const doctorSelect = document.getElementById("assignDoctor");
  const counsellorSelect = document.getElementById("assignCounsellor");
  const currentStudent = studentSelect.value;
  studentSelect.innerHTML = '<option value="">Select student</option>';
  doctorSelect.innerHTML = '<option value="">Select doctor</option>';
  counsellorSelect.innerHTML = '<option value="">Select counsellor</option>';

  users.filter(u => u.role === "student").forEach(user => {
    studentSelect.appendChild(new Option(`${user.name || user.id} (${user.id})`, user.id));
  });
  doctors.forEach(user => doctorSelect.appendChild(new Option(`${user.name || user.id} (${user.id})`, user.id)));
  counsellors.forEach(user => counsellorSelect.appendChild(new Option(`${user.name || user.id} (${user.id})`, user.id)));
  if (currentStudent) studentSelect.value = currentStudent;
}

document.getElementById("registryForm").addEventListener("submit", async e => {
  e.preventDefault();
  const id = canonicalClinicId(document.getElementById("regId").value);
  const role = document.getElementById("regRole").value.trim().toLowerCase();
  const name = document.getElementById("regName").value.trim();
  const recoveryEmail = document.getElementById("regRecoveryEmail").value.trim().toLowerCase();
  if (!id || !role || !name) return;
  if (!isValidIdFormat(id) || detectRole(id) !== role) {
    toast("The ID prefix does not match the selected role.", "err");
    return;
  }
  if (recoveryEmail && !isUsableRecoveryEmail(recoveryEmail)) {
    toast("Enter a valid recovery email or leave it blank.", "err");
    return;
  }
  const submit = e.submitter || e.target.querySelector('[type="submit"]');
  setBusy(submit, true);
  try {
    const existing = await db.collection("registry").doc(id).get();
    const existingData = existing.data() || {};
    const createdAt = existing.exists ? existingData.createdAt || firebase.firestore.FieldValue.serverTimestamp() : firebase.firestore.FieldValue.serverTimestamp();
    await db.collection("registry").doc(id).set({
      name,
      role,
      recoveryEmail: recoveryEmail || existingData.recoveryEmail || null,
      signedUp: existing.exists ? !!existingData.signedUp : false,
      createdAt,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    e.target.reset();
    toast(existing.exists ? "Recognised ID updated." : "Recognised ID saved.", "success");
  } catch (err) {
    console.error("Could not save registry ID", err);
    toast("Could not save this ID. Check Firestore security rules and try again.", "err", 7000);
  } finally {
    setBusy(submit, false, "Save ID");
  }
});

document.getElementById("assignmentForm").addEventListener("submit", async e => {
  e.preventDefault();
  const studentId = document.getElementById("assignStudent").value;
  const doctorId = document.getElementById("assignDoctor").value;
  const counsellorId = document.getElementById("assignCounsellor").value;
  if (!studentId) return;
  try {
    await db.collection("registry").doc(studentId).set({
      assignedDoctor: doctorId || null,
      assignedCounsellor: counsellorId || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    toast("Student assignment saved.", "success");
  } catch (err) {
    console.error("Could not save care-team assignment", err);
    toast("Could not save the assignment. Check Firestore security rules.", "err");
  }
});

function loadReports() {
  db.collection("reports").orderBy("createdAt", "desc").onSnapshot(snap => {
    const list = document.getElementById("reportList");
    const dot = document.getElementById("adminReportDot");
    list.innerHTML = "";
    const reports = [];
    snap.forEach(doc => {
      const data = doc.data();
      if (data.status !== "sorted") reports.push({ id: doc.id, ...data });
    });
    dot?.classList.toggle("hidden", reports.length === 0);
    if (!reports.length) {
      list.innerHTML = '<p class="text-2">No reports yet.</p>';
      return;
    }
    reports.forEach(data => {
      const item = document.createElement("div");
      item.className = "notif-item unread";
      item.dataset.reportId = data.id;
      item.innerHTML = `
        <div class="notif-meta"><strong>${escHtml(data.subject || "Report")}</strong><time>${fmtDate(data.createdAt)}</time></div>
        <div class="notif-body">${escHtml(data.body || "")}</div>
        <p class="mono text-2" style="margin-top:var(--sp-2)">${escHtml(data.studentName || data.studentId || "")}</p>
        <button class="btn btn-sm btn-primary" type="button" data-sort-report="${escHtml(data.id)}" style="margin-top:var(--sp-3)">Mark sorted</button>`;
      list.appendChild(item);
    });
  });
}

document.getElementById("reportList")?.addEventListener("click", async e => {
  const reportItem = e.target.closest("[data-report-id]");
  const reportId = e.target.closest("[data-sort-report]")?.dataset.sortReport || reportItem?.dataset.reportId;
  if (!reportId) return;
  if (!confirm("Mark this report as sorted?")) return;
  await db.collection("reports").doc(reportId).set({
    status: "sorted",
    sortedAt: firebase.firestore.FieldValue.serverTimestamp(),
    studentSortedSeen: false,
  }, { merge: true });
  toast("Report marked as sorted. The student has been notified.", "success");
});

async function loadAdminEmergencyContacts() {
  emergencyContacts = await loadEmergencyContacts();
  renderAdminEmergencyContacts();
}

function renderAdminEmergencyContacts() {
  const list = document.getElementById("adminEmergencyList");
  if (!list) return;
  list.innerHTML = "";
  emergencyContacts.forEach((contact, index) => {
    const item = document.createElement("div");
    item.className = "appt-item";
    item.innerHTML = `
      <div class="appt-item-info">
        <strong>${escHtml(contact.name || "")}</strong>
        <span>${escHtml(contact.details || "")}</span>
      </div>
      <div class="actions">
        <button class="btn btn-sm btn-ghost" data-edit-emergency="${index}">Edit</button>
        <button class="btn btn-sm btn-danger" data-delete-emergency="${index}">Delete</button>
      </div>`;
    list.appendChild(item);
  });
}

async function saveEmergencyContacts() {
  await db.collection("siteSettings").doc("emergencyContacts").set({
    contacts: emergencyContacts,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

document.getElementById("emergencyForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const indexValue = document.getElementById("emergencyIndex").value;
  const contact = {
    name: document.getElementById("emergencyName").value.trim(),
    details: document.getElementById("emergencyDetails").value.trim(),
  };
  if (!contact.name || !contact.details) return;
  if (indexValue === "") emergencyContacts.push(contact);
  else emergencyContacts[Number(indexValue)] = contact;
  await saveEmergencyContacts();
  e.target.reset();
  document.getElementById("emergencyIndex").value = "";
  document.getElementById("emergencySubmit").textContent = "Save contact";
  renderAdminEmergencyContacts();
  toast("Emergency contacts updated.", "success");
});

document.getElementById("clearEmergencyForm")?.addEventListener("click", () => {
  document.getElementById("emergencyForm").reset();
  document.getElementById("emergencyIndex").value = "";
  document.getElementById("emergencySubmit").textContent = "Save contact";
});

document.getElementById("adminEmergencyList")?.addEventListener("click", async e => {
  const action = e.target.closest("[data-edit-emergency], [data-delete-emergency]");
  if (!action) return;
  const editIndex = action.dataset.editEmergency;
  const deleteIndex = action.dataset.deleteEmergency;
  if (editIndex !== undefined) {
    const contact = emergencyContacts[Number(editIndex)];
    document.getElementById("emergencyIndex").value = editIndex;
    document.getElementById("emergencyName").value = contact.name || "";
    document.getElementById("emergencyDetails").value = contact.details || "";
    document.getElementById("emergencySubmit").textContent = "Update contact";
  }
  if (deleteIndex !== undefined && confirm("Delete this emergency contact?")) {
    emergencyContacts.splice(Number(deleteIndex), 1);
    await saveEmergencyContacts();
    renderAdminEmergencyContacts();
    toast("Emergency contact deleted.", "success");
  }
});

function escHtml(s = "") {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
