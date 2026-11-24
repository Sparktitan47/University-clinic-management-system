const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

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
