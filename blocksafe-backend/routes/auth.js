// routes/auth.js
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Initialize the Google Auth client with your Client ID
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// This is the endpoint your mobile app will call
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;

    // 1. VERIFY THE GOOGLE ID TOKEN
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    // Extract user info from the verified token
    const { sub: googleId, email, name } = payload;

    // 2. FIND OR CREATE A USER IN YOUR DATABASE (Upsert)
    // Prisma's upsert is perfect for this: it finds a user by a unique field (googleId),
    // and if it doesn't exist, it creates a new one.
    const user = await prisma.user.upsert({
      where: { googleId },
      update: {}, // You can update fields here if needed on subsequent logins
      create: {
        googleId,
        email,
        name,
      },
    });

    // 3. CREATE YOUR OWN JWT (YOUR APP'S "ACCESS CARD")
    // This token is what your app will use to authenticate with your backend from now on.
    const ourAppToken = jwt.sign(
      { userId: user.id }, // The data you want to embed in the token
      process.env.JWT_SECRET, // The secret key to sign the token
      { expiresIn: '7d' } // Token expiration
    );

    // 4. SEND THE TOKEN AND USER INFO BACK TO THE APP
    res.status(200).json({
      message: "Authentication successful!",
      token: ourAppToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });

  } catch (error) {
    console.error("Authentication error:", error);
    res.status(401).json({ message: "Authentication failed. Please try again." });
  }
});

module.exports = router;