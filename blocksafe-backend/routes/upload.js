// routes/upload.js
const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const router = express.Router();

// Configure multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Configure the S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

router.post('/upload', upload.single('media_file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded." });
  }

  // Create a unique filename
  const uniqueSuffix = crypto.randomBytes(16).toString('hex');
  const key = `${uniqueSuffix}-${req.file.originalname}`;

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
  });

  try {
    await s3Client.send(command);
    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    // Here, we would also get the SHA-256 hash and call the blockchain service
    // For now, we'll just return the S3 URL

    console.log(`File uploaded successfully to S3: ${fileUrl}`);
    res.status(200).json({ 
      message: "File uploaded successfully!", 
      s3Url: fileUrl 
    });

  } catch (error) {
    console.error("Error uploading to S3:", error);
    res.status(500).json({ message: "Error uploading file." });
  }
});

module.exports = router;