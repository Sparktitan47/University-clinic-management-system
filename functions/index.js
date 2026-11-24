const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

exports.completeEnrollment = onCall(async request => {
  const uid = request.auth?.uid;
  const email = String(request.auth?.token?.email || "").trim().toLowerCase();
  if (!uid || request.auth.token.email_verified !== true || !email) {
    throw new HttpsError("permission-denied", "Verify the approved account email before completing enrollment.");
  }
  const clinicId = String(request.data?.clinicId || "").trim();
  if (!/^(Student-[A-Za-z0-9]+|DOC-[A-Za-z0-9]+|COUN-[A-Za-z0-9]+|PHR-[A-Za-z0-9]+)$/.test(clinicId)) {
    throw new HttpsError("invalid-argument", "Enrollment could not be completed.");
  }
  const registryRef = db.collection("registry").doc(clinicId);
  const role = await db.runTransaction(async tx => {
    const current = await tx.get(registryRef);
    if (!current.exists) throw new HttpsError("permission-denied", "Enrollment could not be completed.");
    const currentRole = String(current.get("role") || "").toLowerCase();
    const approvedEmail = String(current.get("authEmail") || current.get("recoveryEmail") || "").trim().toLowerCase();
    if (!["student", "doctor", "counsellor", "pharmacist"].includes(currentRole) || approvedEmail !== email) {
      throw new HttpsError("permission-denied", "Enrollment could not be completed.");
    }
    const existingUid = current.get("authUid");
    if (current.get("signedUp") === true && existingUid !== uid) {
      throw new HttpsError("already-exists", "Enrollment could not be completed.");
    }
    tx.set(registryRef, {
      authUid: uid,
      authEmail: email,
      signedUp: true,
      signedUpAt: current.get("signedUpAt") || FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(db.collection("directory").doc(clinicId), {
      name: current.get("name") || clinicId,
      role: currentRole,
    }, { merge: true });
    return currentRole;
  });
  await getAuth().setCustomUserClaims(uid, { clinicId, role });
  return { clinicId, role };
});

exports.bookAppointment = onCall(async request => {
  const claims = request.auth?.token || {};
  const studentId = claims.clinicId;
  if (!studentId || claims.role !== "student") {
    throw new HttpsError("permission-denied", "Only authenticated students can book appointments.");
  }

  const { staffId, staffType, slotId, reason } = request.data || {};
  if (typeof staffId !== "string" || typeof slotId !== "string"
      || !["doctor", "counsellor"].includes(staffType)
      || typeof reason !== "string" || !reason.trim() || reason.length > 2000) {
    throw new HttpsError("invalid-argument", "Appointment details are invalid.");
  }

  const studentRef = db.collection("registry").doc(studentId);
  const availabilityRef = db.collection("availability").doc(staffId);
  const appointmentRef = db.collection("appointments").doc();

  await db.runTransaction(async tx => {
    const [studentSnap, availabilitySnap] = await Promise.all([
      tx.get(studentRef), tx.get(availabilityRef),
    ]);
    if (!studentSnap.exists || !availabilitySnap.exists) {
      throw new HttpsError("not-found", "The selected appointment is unavailable.");
    }
    const assignmentField = staffType === "doctor" ? "assignedDoctor" : "assignedCounsellor";
    if (studentSnap.get(assignmentField) !== staffId) {
      throw new HttpsError("permission-denied", "This staff member is not assigned to the student.");
    }
    const slots = availabilitySnap.get("slots") || [];
    const slot = slots.find(item => item.id === slotId);
    if (!slot || slot.taken) {
      throw new HttpsError("failed-precondition", "That appointment slot is no longer available.");
    }
    tx.update(availabilityRef, {
      slots: slots.map(item => item.id === slotId ? { ...item, taken: true } : item),
    });
    tx.create(appointmentRef, {
      id: appointmentRef.id,
      studentId,
      studentName: studentSnap.get("name") || studentId,
      staffId,
      staffType,
      slot: slot.label,
      slotId,
      reason: reason.trim(),
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { appointmentId: appointmentRef.id };
});

exports.setAppointmentStatus = onCall(async request => {
  const claims = request.auth?.token || {};
  const staffId = claims.clinicId;
  if (!staffId || !["doctor", "counsellor"].includes(claims.role)) {
    throw new HttpsError("permission-denied", "Only clinical staff can update appointment status.");
  }
  const { appointmentId, status } = request.data || {};
  if (typeof appointmentId !== "string" || !["confirmed", "cancelled"].includes(status)) {
    throw new HttpsError("invalid-argument", "Appointment update is invalid.");
  }
  const appointmentRef = db.collection("appointments").doc(appointmentId);
  await db.runTransaction(async tx => {
    const appointmentSnap = await tx.get(appointmentRef);
    if (!appointmentSnap.exists || appointmentSnap.get("staffId") !== staffId) {
      throw new HttpsError("not-found", "Appointment not found.");
    }
    if (appointmentSnap.get("status") !== "pending") {
      throw new HttpsError("failed-precondition", "Only pending appointments can be updated.");
    }
    const availabilityRef = db.collection("availability").doc(staffId);
    const availabilitySnap = status === "cancelled" ? await tx.get(availabilityRef) : null;
    tx.update(appointmentRef, { status });
    if (availabilitySnap?.exists) {
      const slotId = appointmentSnap.get("slotId");
      const slots = availabilitySnap.get("slots") || [];
      tx.update(availabilityRef, {
        slots: slots.map(item => item.id === slotId ? { ...item, taken: false } : item),
      });
    }
  });
  return { appointmentId, status };
});
