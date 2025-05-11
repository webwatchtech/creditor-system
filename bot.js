require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const creditorSchema = new mongoose.Schema({
  name: String,
  status: String,
  lastVisit: Date,
  followUp: Date,
  // ... other fields
});

const Creditor = mongoose.model('Creditor', creditorSchema);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

cron.schedule('*/1 * * * *', async () => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

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

      await bot.telegram.sendMessage(
        process.env.TELEGRAM_CHAT_ID,
        message
      );
    } else {
      // New message when no payees
      const noPayeesMessage = `📅 No pending payees for today! \n\nAll clear! 🎉`;
      await bot.telegram.sendMessage(
        process.env.TELEGRAM_CHAT_ID,
        noPayeesMessage
      );
    }
  } catch (err) {
    console.error('Cron job error:', err);
    await bot.telegram.sendMessage(
      process.env.TELEGRAM_CHAT_ID,
      '⚠️ Error checking pending payees. Please check server logs.'
    );
  }
});

bot.launch();
console.log('Telegram bot started');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));