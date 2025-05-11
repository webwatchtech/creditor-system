require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// --- Mongoose Schema & Model (using server.js version) ---
const creditorSchema = new mongoose.Schema({
  name: { type: String, required: true, uppercase: true },
  lastVisit: { type: Date, default: Date.now },
  followUp: { type: Date },
  status: { type: String, enum: ['pending', 'paid', 'overdue'], default: 'pending' },
  history: [
    {
      date: { type: Date, default: Date.now },
      action: String,
      details: String,
      amount: Number
    }
  ]
});

const Creditor = mongoose.model('Creditor', creditorSchema);

// --- Telegram Bot Setup ---
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// --- Cron Job ---
cron.schedule('12 01 * * *', async () => { // 19:20 in 24h format (7:20pm)
  try {
    // Use IST timezone for date calculations
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0); // IST midnight

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999); // IST end of day

    const pendingPayees = await Creditor.find({
      status: 'pending',
      followUp: {
        $gte: todayStart,
        $lte: todayEnd
      }
    });

    if (pendingPayees.length > 0) {
      let message = "📋 Today's Pending Payees:\n\n";
      pendingPayees.forEach((payee, index) => {
        message += `${index + 1}. ${payee.name}\n`;
        message += `   Last visited: ${new Date(payee.lastVisit).toLocaleDateString('en-GB')}\n\n`;
      });
      await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
    } else {
      await bot.telegram.sendMessage(
        process.env.TELEGRAM_CHAT_ID,
        '📅 No pending payees for today! \n\nAll clear! 🎉'
      );
    }
  } catch (err) {
    console.error('Cron job error:', err);
    await bot.telegram.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      '⚠️ Error checking pending payees. Please check server logs.'
    );
  }
}, {
  timezone: 'Asia/Kolkata' // Explicitly set timezone
});

// --- Express Server Setup ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- REST API Routes ---
app.post('/api/creditors', async (req, res) => {
  try {
    const newCreditor = await Creditor.create(req.body);
    res.status(201).json(newCreditor);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/creditors', async (req, res) => {
  try {
    const list = await Creditor.find().sort({ followUp: 1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/creditors/:id', async (req, res) => {
  try {
    const { historyEntry, ...fields } = req.body;
    const updateDoc = {};

    if (Object.keys(fields).length) updateDoc.$set = fields;
    if (historyEntry) updateDoc.$push = { history: historyEntry };

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

app.delete('/api/creditors/:id', async (req, res) => {
  try {
    await Creditor.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- SPA Fallback ---
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start Services ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});

bot.launch().then(() => {
  console.log('🤖 Telegram bot started');
});

// --- Graceful Shutdown ---
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit();
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit();
});