require('dotenv').config();
const express = require('express');
const cors = require('cors');

// --- IMPORT ROUTES ---
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload'); // new route

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- USE ROUTES ---
app.use('/api/auth', authRoutes);
app.use('/api', uploadRoutes); // new route

app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
