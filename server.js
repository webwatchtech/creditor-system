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

// --- Register Bot Commands ---
bot.telegram.setMyCommands([
  { command: 'start', description: 'Show subscription menu' },
  { command: 'subscribe', description: 'Enable daily updates' },
  { command: 'unsubscribe', description: 'Disable notifications' }
]);

// --- Command Handlers ---
bot.start(async (ctx) => {
  await showSubscriptionButtons(ctx);
});

bot.command('subscribe', async (ctx) => {
  await handleSubscription(ctx, true);
});

bot.command('unsubscribe', async (ctx) => {
  await handleSubscription(ctx, false);
});

// --- Button Handlers ---
bot.action('subscribe', async (ctx) => {
  await handleSubscription(ctx, true);
  await ctx.answerCbQuery();
});

bot.action('unsubscribe', async (ctx) => {
  await handleSubscription(ctx, false);
  await ctx.answerCbQuery();
});

// --- Common Subscription Handler ---
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

async function showSubscriptionButtons(ctx) {
  const buttons = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Subscribe', 'subscribe')],
    [Markup.button.callback('❌ Unsubscribe', 'unsubscribe')]
  ]);

  await ctx.replyWithMarkdown(
    '🔔 *Creditor Updates Subscription* 🔔\n\n' +
    'Choose your notification preference:',
    buttons
  );
}

// --- Scheduled Notifications ---
cron.schedule('0 12,18 * * *', async () => {
  try {
    const istDate = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const todayStart = new Date(istDate);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(istDate);
    todayEnd.setHours(23, 59, 59, 999);

    const pendingPayees = await Creditor.find({
      status: 'pending',
      followUp: { $gte: todayStart, $lte: todayEnd }
    });

    let message;
    if (pendingPayees.length > 0) {
      message = "📋 *Pending Payees Reminder* 📋\n\n";
      pendingPayees.forEach((payee, index) => {
        message += `${index + 1}. ${payee.name}\n`;
        message += `   Follow-up: ${new Date(payee.followUp).toLocaleDateString('en-IN')}\n\n`;
      });
    } else {
      message = '🎉 *No pending payees for today!*';
    }

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

// ... Keep other API routes same as previous version ...

// --- Start Services ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

bot.launch()
  .then(() => {
    console.log('🤖 Telegram bot started and commands are active!');
  })
  .catch(err => {
    console.error('❌ Telegram bot failed to start:', err);
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