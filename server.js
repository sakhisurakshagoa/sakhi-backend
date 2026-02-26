const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const CryptoJS = require("crypto-js");
require("dotenv").config();

// ---------- Firebase Admin Init ----------
const serviceAccount = require("./firebase-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ---------- Helpers ----------
const ENC_KEY = process.env.ENC_KEY || "dev-secret-key-change-this";

function encrypt(text) {
  if (!text) return "";
  return CryptoJS.AES.encrypt(text, ENC_KEY).toString();
}
function sha256(text) {
  return CryptoJS.SHA256(text).toString();
}
function randomPin() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}

// ---------- Express ----------
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => res.send("✅ Backend running"));

// ---------- Submit Complaint ----------
app.post("/api/complaint", async (req, res) => {
  try {
    const { title, category, location, date, description, anonymous } = req.body;

    if (!title || !category || !description) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const pin = randomPin();
    const pinHash = sha256(pin);

    const docRef = await db.collection("complaints").add({
      title: encrypt(title),
      description: encrypt(description),
      location: encrypt(location || ""),
      category,
      date: date || "",
      anonymous: !!anonymous,
      status: "Open",
      pinHash,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      success: true,
      complaintId: docRef.id,
      pin, // show once to user
    });
  } catch (e) {
    console.error("Submit error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Firebase Auth Middleware ----------
async function verifyFirebaseToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ success: false, message: "No auth header" });
  }

  const token = header.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // uid, email
    next();
  } catch (e) {
    console.error("Auth error:", e);
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

// ---------- Admin: List Complaints (Protected) ----------
app.get("/api/admin/complaints", verifyFirebaseToken, async (req, res) => {
  try {
    const snap = await db
      .collection("complaints")
      .orderBy("createdAt", "desc")
      .get();

    const data = snap.docs.map((d) => ({
      id: d.id,
      category: d.data().category,
      status: d.data().status || "Open",
      createdAt: d.data().createdAt || null,
    }));

    return res.json({ success: true, data });
  } catch (e) {
    console.error("Admin list error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Admin: Update Complaint Status (Protected) ----------
app.put("/api/admin/complaints/:id/status", verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["Open", "In Review", "Resolved"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    await db.collection("complaints").doc(id).update({ status });
    return res.json({ success: true });
  } catch (e) {
    console.error("Update status error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Track Complaint ----------
app.post("/api/track", async (req, res) => {
  try {
    const { complaintId, pin } = req.body;
    if (!complaintId || !pin) {
      return res.status(400).json({ success: false, message: "Missing ID or PIN" });
    }

    const doc = await db.collection("complaints").doc(complaintId).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const ok = sha256(pin) === doc.data().pinHash;
    if (!ok) {
      return res.status(401).json({ success: false, message: "Invalid PIN" });
    }

    return res.json({ success: true, status: doc.data().status || "Open" });
  } catch (e) {
    console.error("Track error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Start Server ----------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});