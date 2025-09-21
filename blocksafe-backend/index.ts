import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ethers } from 'ethers';
import GuardianLogABI from './contracts/GuardianLog.json';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health route
app.get('/', (req: Request, res: Response) => {
  res.send('Server is running!');
});

// --- Upload Route ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ""
  }
});

const provider = new ethers.JsonRpcProvider(process.env.AMOY_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

const guardianLogContract = new ethers.Contract(
  process.env.AMOY_CONTRACT_ADDRESS || "",
  GuardianLogABI.abi,
  wallet
);

app.post('/api/upload', upload.single('media_file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded." });
  }

  try {
    const key = `${crypto.randomBytes(16).toString('hex')}-${req.file.originalname}`;

    const s3Command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    });

    await s3Client.send(s3Command);

    const s3Url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    const evidenceHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    const tx = await guardianLogContract.logEvidence(evidenceHash, s3Url, "GPS_PLACEHOLDER");
    await tx.wait();

    res.status(200).json({
      message: "File uploaded and evidence logged!",
      s3Url,
      blockchainTxHash: tx.hash
    });
  } catch (error) {
    console.error("❌ FATAL ERROR in /upload route:", error);
    res.status(500).json({ message: "An internal server error occurred." });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
