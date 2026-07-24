// ============================================================
//  PHARMACIST.JS - pharmacist-dashboard.html
// ============================================================
initTheme();
let ME = {};
let editingDrugId = null;

guardRoute("pharmacist").then(user => {
  ME = user;
  document.getElementById("staffName").textContent = user.name;
  document.getElementById("staffId").textContent = user.id;
  attachThemeToggle("themeBtn");
  loadDrugs();
});

document.querySelectorAll(".sign-out-btn").forEach(btn => btn.addEventListener("click", goOfflineAndSignOut));

db.collection("pharmacy").orderBy("name").onSnapshot(snap => {
  const grid = document.getElementById("drugGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (snap.empty) {
    grid.innerHTML = '<p class="text-2">No medications listed yet.</p>';
    return;
  }
  snap.forEach(doc => renderDrug(doc.id, doc.data()));
});

function loadDrugs() {
  // Snapshot listener above keeps the grid live.
}

function renderDrug(id, data) {
  const pct = Math.min(100, Math.round(((data.qty || 0) / (data.maxQty || 100)) * 100));
  const card = document.createElement("div");
  card.className = "card drug-editor-card";
  card.innerHTML = `
    <h4>${escHtml(data.name || "Medication")}</h4>
    <p class="text-2">${escHtml(data.category || "General")} - ${escHtml(data.unit || "units")}</p>
    <span class="badge badge-${data.available ? "green" : "red"}">${data.available ? "Available" : "Unavailable"}</span>
    <div class="stock-bar-wrap">
      <span class="mono">${data.qty || 0} / ${data.maxQty || 0}</span>
      <div class="stock-bar"><div class="stock-bar-fill" style="width:${pct}%;background:${pct < 20 ? "var(--red)" : "var(--green)"}"></div></div>
    </div>
    <div class="flex gap-2">
      <button class="btn btn-sm btn-ghost" data-edit="${id}">Edit</button>
      <button class="btn btn-sm btn-danger" data-delete="${id}">Delete</button>
    </div>`;
  card.querySelector("[data-edit]").addEventListener("click", () => editDrug(id, data));
  card.querySelector("[data-delete]").addEventListener("click", () => deleteDrug(id));
  document.getElementById("drugGrid").appendChild(card);
}

function editDrug(id, data) {
  editingDrugId = id;
  document.getElementById("drugName").value = data.name || "";
  document.getElementById("drugCategory").value = data.category || "";
  document.getElementById("drugQty").value = data.qty || 0;
  document.getElementById("drugMaxQty").value = data.maxQty || 100;
  document.getElementById("drugUnit").value = data.unit || "units";
  document.getElementById("drugAvailable").checked = !!data.available;
  document.getElementById("drugSubmit").textContent = "Update medication";
}

async function deleteDrug(id) {
  await db.collection("pharmacy").doc(id).delete();
  toast("Medication removed.", "success");
}

document.getElementById("drugForm").addEventListener("submit", async e => {
  e.preventDefault();
  const payload = {
    name: document.getElementById("drugName").value.trim(),
    category: document.getElementById("drugCategory").value.trim(),
    qty: Number(document.getElementById("drugQty").value) || 0,
    maxQty: Number(document.getElementById("drugMaxQty").value) || 0,
    unit: document.getElementById("drugUnit").value.trim() || "units",
    available: document.getElementById("drugAvailable").checked,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: ME.id,
  };
  if (!payload.name) return;
  const ref = editingDrugId ? db.collection("pharmacy").doc(editingDrugId) : db.collection("pharmacy").doc();
  await ref.set(payload, { merge: true });
  editingDrugId = null;
  e.target.reset();
  document.getElementById("drugAvailable").checked = true;
  document.getElementById("drugSubmit").textContent = "Save medication";
  toast("Medication saved.", "success");
});

document.getElementById("clearDrugForm").addEventListener("click", () => {
  editingDrugId = null;
  document.getElementById("drugForm").reset();
  document.getElementById("drugAvailable").checked = true;
  document.getElementById("drugSubmit").textContent = "Save medication";
});

function escHtml(s = "") {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
