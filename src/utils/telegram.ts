import axios from 'axios';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const isEnabled = (): boolean => !!TELEGRAM_BOT_TOKEN && !!TELEGRAM_CHAT_ID;

const send = async (message: string): Promise<void> => {
    if (!isEnabled()) return;
    try {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' },
            { timeout: 5000 }
        );
    } catch {
        // Silently fail to avoid disrupting trading
    }
};

const telegram = {
    isEnabled,
    send,
    tradeExecuted: (side: string, amount: number, price: number, market: string) =>
        send(`✅ *${side}* $${amount.toFixed(2)} @ $${price.toFixed(4)}\n📊 ${market}`),
    killSwitch: (lossPct: number) =>
        send(`🛑 *KILL SWITCH TRIGGERED*\nDaily loss: ${lossPct.toFixed(1)}%\nTrading halted.`),
    error: (msg: string) =>
        send(`❌ *Error*: ${msg}`),
    startup: (traderCount: number, balance: number) =>
        send(`🚀 *Bot Started*\nTracking ${traderCount} trader(s)\nBalance: $${balance.toFixed(2)}`),
};

export default telegram;
