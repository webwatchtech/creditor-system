require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// --- Database Connection ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// --- Schemas & Models ---
const creditorSchema = new mongoose.Schema({
  name: { type: String, required: true, uppercase: true },
  lastVisit: { type: Date, default: Date.now },
  followUp: Date,
  status: { 
    type: String, 
    enum: ['pending', 'paid', 'overdue'], 
    default: 'pending' 
  },
  history: [{
    date: { type: Date, default: Date.now },
    action: String,
    details: String,
    amount: Number
  }]
});

const subscriberSchema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true },
  isSubscribed: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const Creditor = mongoose.model('Creditor', creditorSchema);
const Subscriber = mongoose.model('Subscriber', subscriberSchema);

// --- Telegram Bot Setup ---
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// --- Unified Subscription Handler ---
async function handleSubscription(ctx, subscribe) {
  try {
    await Subscriber.findOneAndUpdate(
      { chatId: ctx.chat.id },
      { isSubscribed: subscribe },
      { upsert: true, new: true }
    );
    
    const message = subscribe 
      ? '🎉 You\'re now subscribed to daily updates!' 
      : '🔕 You\'ve unsubscribed from updates.';
      
    await ctx.reply(message);
  } catch (err) {
    console.error('Subscription error:', err);
    await ctx.reply('⚠️ Error updating subscription. Please try again.');
  }
}

// --- Text Commands ---
bot.command('subscribe', async (ctx) => {
  await handleSubscription(ctx, true);
});

bot.command('unsubscribe', async (ctx) => {
  await handleSubscription(ctx, false);
});

// --- Inline Buttons ---
bot.start(async (ctx) => {
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Subscribe', 'subscribe_btn')],
    [Markup.button.callback('❌ Unsubscribe', 'unsubscribe_btn')]
  ]);

  await ctx.replyWithMarkdown(
    '🔔 *Creditor Updates Subscription* 🔔\n\n' +
    'Choose your notification preference:',
    buttons
  );
});

bot.action('subscribe_btn', async (ctx) => {
  await handleSubscription(ctx, true);
  await ctx.answerCbQuery();
});

bot.action('unsubscribe_btn', async (ctx) => {
  await handleSubscription(ctx, false);
  await ctx.answerCbQuery();
});

// --- Scheduled Notifications ---
cron.schedule('0 12,18 * * *', async () => {
  try {
    // Get IST day boundaries
    const istDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const todayStart = new Date(istDate);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(istDate);
    todayEnd.setHours(23, 59, 59, 999);

    // Find pending payees
    const pendingPayees = await Creditor.find({
      status: 'pending',
      followUp: { $gte: todayStart, $lte: todayEnd }
    });

    // Prepare message with last visit date (no time)
    let message;
    if (pendingPayees.length > 0) {
      message = "📋 *Today's Payment Reminder* 📋\n\n";
      pendingPayees.forEach((payee, index) => {
        message += `${index + 1}. ${payee.name}\n`;
        message += `   Last-Visit: ${new Date(payee.lastVisit).toLocaleDateString('en-IN')}\n\n`;
      });
    } else {
      message = '🎉 *No pending payees for today!*';
    }

    // Send to all subscribers
    const subscribers = await Subscriber.find({ isSubscribed: true });
    for (const sub of subscribers) {
      try {
        await bot.telegram.sendMessage(sub.chatId, message, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error(`Failed to send to ${sub.chatId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Cron job error:', err);
  }
}, {
  timezone: 'Asia/Kolkata'
});

// --- Express Server Setup ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---
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
  console.log(`🚀 Server running on http://localhost:${PORT}`);
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