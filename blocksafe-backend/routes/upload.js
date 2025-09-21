const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { ethers } = require('ethers');
const GuardianLogABI = require('../contracts/GuardianLog.json');

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const s3Client = new S3Client({ /* ... your S3 config ... */ });
const provider = new ethers.JsonRpcProvider(process.env.AMOY_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const guardianLogContract = new ethers.Contract(
  process.env.AMOY_CONTRACT_ADDRESS,
  GuardianLogABI.abi,
  wallet
);

router.post('/upload', upload.single('media_file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  try {
    const key = `${crypto.randomBytes(16).toString('hex')}-${req.file.originalname}`;
    const s3Command = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
    });

    await s3Client.send(s3Command);
    const s3Url = `https://${process.env.AWS_BUCKET_NAME}.s3...amazonaws.com/${key}`;
    const evidenceHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    
    const tx = await guardianLogContract.logEvidence(evidenceHash, s3Url, "GPS_PLACEHOLDER");
    await tx.wait();
    
    res.status(200).json({ 
      message: "File uploaded and evidence logged!", 
      s3Url,
      blockchainTxHash: tx.hash
    });

  } catch (error) {
    // --- THIS IS THE FIX ---
    // This will print the exact error to your terminal
    console.error("❌ FATAL ERROR in /upload route:", error);
    res.status(500).json({ message: "An internal server error occurred." });
  }
});

module.exports = router;