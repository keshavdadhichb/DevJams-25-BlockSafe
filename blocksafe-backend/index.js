// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// --- IMPORT YOUR AUTH ROUTE ---
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- USE YOUR AUTH ROUTE ---
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});