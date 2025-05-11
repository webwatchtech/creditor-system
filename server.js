// Load environment variables
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// --- Middleware ---
app.use(cors());
app.use(express.json());

// 1) Serve your front‑end from "public/"
app.use(express.static(path.join(__dirname, 'public')));

// --- MongoDB Connection ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// --- Mongoose Schema & Model ---
const creditorSchema = new mongoose.Schema({
  name:      { type: String, required: true, uppercase: true },
  lastVisit: { type: Date,   default: Date.now },
  followUp:  { type: Date },
  status:    { type: String, enum: ['pending','paid','overdue'], default: 'pending' },
  history: [
    {
      date:    { type: Date, default: Date.now },
      action:  String,
      details: String,
      amount:  Number
    }
  ]
});

const Creditor = mongoose.model('Creditor', creditorSchema);

// --- RESTful API Routes ---

// CREATE
app.post('/api/creditors', async (req, res) => {
  try {
    const newCreditor = await Creditor.create(req.body);
    res.status(201).json(newCreditor);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// READ ALL
app.get('/api/creditors', async (req, res) => {
  try {
    const list = await Creditor.find().sort({ followUp: 1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE (mark paid, reschedule, or add history entry)
app.put('/api/creditors/:id', async (req, res) => {
  try {
    // Destructure historyEntry out of the body
    const { historyEntry, ...fields } = req.body;

    // Build a dynamic update document
    const updateDoc = {};
    if (Object.keys(fields).length) {
      updateDoc.$set = fields;
    }
    if (historyEntry) {
      updateDoc.$push = { history: historyEntry };
    }

    const updated = await Creditor.findByIdAndUpdate(
      req.params.id,
      updateDoc,
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// DELETE
app.delete('/api/creditors/:id', async (req, res) => {
  try {
    await Creditor.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- SPA Fallback for all other routes ---
// Use a regex to avoid the “Missing parameter name” error
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start Server ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
