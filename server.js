import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import crypto from "crypto";
import { ethers } from "ethers";
import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🔥 Firebase Init
const serviceAccount = JSON.parse(fs.readFileSync("./firebase-key.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// 🔗 Blockchain Init (Polygon Amoy)
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const ABI = ["function fileComplaint(string memory complaintHash) public"];
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);

// 📥 1) Submit Complaint (User)
app.post("/api/complaint", async (req, res) => {
  try {
    const data = req.body;

    // Hash for blockchain proof
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");

    // Write hash to blockchain
    const tx = await contract.fileComplaint(hash);
    const receipt = await tx.wait();

    // Generate complaint ID
    const complaintId = "SAKHI-" + Date.now();

    // Store full data in Firebase (encrypt later if needed)
    await db.collection("complaints").doc(complaintId).set({
      status: "Submitted",
      txHash: receipt.hash,
      timestamp: new Date().toISOString(),
      hash,
      data,
    });

    return res.json({
      success: true,
      complaintId,
      txHash: receipt.hash,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Submit error:", error);
    return res.status(500).json({ success: false, error: "Submit failed" });
  }
});

// 🔎 2) Track Complaint (User)
app.get("/api/complaint/:id", async (req, res) => {
  try {
    const doc = await db.collection("complaints").doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, error: "Complaint not found" });
    }

    const { status, txHash, timestamp } = doc.data();
    return res.json({ success: true, status, txHash, timestamp });
  } catch (error) {
    console.error("❌ Track error:", error);
    return res.status(500).json({ success: false, error: "Track failed" });
  }
});

// 📋 3) Admin – List All Complaints
app.get("/api/admin/complaints", async (req, res) => {
  try {
    const snap = await db.collection("complaints").orderBy("timestamp", "desc").get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ success: true, list });
  } catch (error) {
    console.error("❌ Admin list error:", error);
    return res.status(500).json({ success: false, error: "Fetch failed" });
  }
});

// 🔄 4) Admin – Update Complaint Status
app.put("/api/admin/complaints/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    await db.collection("complaints").doc(req.params.id).update({ status });

    return res.json({ success: true });
  } catch (error) {
    console.error("❌ Admin update error:", error);
    return res.status(500).json({ success: false, error: "Update failed" });
  }
});

// 🚀 Start Server
app.listen(4000, () => {
  console.log("✅ Backend running at http://localhost:4000");
});
