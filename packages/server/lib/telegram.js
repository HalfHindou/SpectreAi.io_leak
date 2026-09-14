/**
 * Telegram Bot — Spectre AI notifications and two-way chat relay.
 *
 * Features:
 *   - Long polling for incoming messages (no webhook URL needed)
 *   - broadcastMessage(text) — send to all registered chats
 *   - Chat IDs persisted to disk between server restarts
 *   - Incoming message queue readable by the app via GET /api/telegram/messages
 *
 * Commands users can send to the bot:
 *   /start  — subscribe to notifications
 *   /stop   — unsubscribe
 *   /status — show server/bot status with uptime
 *   /help   — list all commands
 *   Any other text → queued for the app to read; bot acknowledges receipt
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;

// ── Persistence ──────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHATS_FILE = path.join(DATA_DIR, 'telegram-chats.json');

let chatIds = new Set();

function loadChatIds() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const raw = fs.readFileSync(CHATS_FILE, 'utf8');
    chatIds = new Set(JSON.parse(raw));
    console.log(`[Telegram] Loaded ${chatIds.size} registered chat(s)`);
  } catch (_) {
    chatIds = new Set();
  }
}

function saveChatIds() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CHATS_FILE, JSON.stringify([...chatIds]));
  } catch (e) {
    console.error('[Telegram] Failed to save chat IDs:', e.message);
  }
}

// ── Incoming message queue (last 100 messages, for GET /api/telegram/messages) ─

const incomingMessages = [];

function queueMessage(chatId, username, text, messageId, date) {
  incomingMessages.push({
    id: messageId,
    chatId,
    username,
    text,
    timestamp: new Date(date * 1000).toISOString(),
  });
  if (incomingMessages.length > 100) incomingMessages.shift();
}

function getIncomingMessages(limit = 20) {
  return incomingMessages.slice(-limit).reverse();
}

// ── Telegram API helpers ──────────────────────────────────────────────────────

async function apiPost(method, body) {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[Telegram] ${method} failed:`, data.description);
    }
    return data;
  } catch (e) {
    console.error(`[Telegram] API error (${method}):`, e.message);
    return null;
  }
}

async function sendMessage(chatId, text) {
  return apiPost('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

/**
 * Send text to all registered chats.
 * Called by pushNotification and POST /api/telegram/send.
 */
async function broadcastMessage(text) {
  if (!API_BASE || chatIds.size === 0) return;
  await Promise.all([...chatIds].map(id => sendMessage(id, text)));
}

// ── Greeting detection ────────────────────────────────────────────────────────

const GREETING_RE = /^(hi|hello|hey|sup|yo|hiya|howdy|greetings|good\s*(morning|afternoon|evening|day))[\s!?.,]*$/i;

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Update handler ────────────────────────────────────────────────────────────

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const firstName = msg.from?.first_name || null;
  const username = msg.from?.username || firstName || String(chatId);

  if (text === '/start') {
    chatIds.add(chatId);
    saveChatIds();
    await sendMessage(
      chatId,
      '<b>Spectre AI connected.</b>\n\n' +
        'You will receive notifications for breaking news and completed tasks.\n\n' +
        'Commands:\n' +
        '/help — list all commands\n' +
        '/status — server status\n' +
        '/stop — unsubscribe\n\n' +
        'Send any message to relay it to the Spectre dashboard.'
    );
    return;
  }

  if (text === '/stop') {
    chatIds.delete(chatId);
    saveChatIds();
    await sendMessage(chatId, 'Unsubscribed. Send /start to reconnect.');
    return;
  }

  if (text === '/help') {
    await sendMessage(
      chatId,
      '<b>Spectre AI Bot — Commands</b>\n\n' +
        '/start — subscribe to notifications\n' +
        '/stop — unsubscribe from notifications\n' +
        '/status — show server and bot status\n' +
        '/help — show this message\n\n' +
        'Send any text to relay a message to the Spectre dashboard.'
    );
    return;
  }

  if (text === '/status') {
    const uptimeStr = formatUptime(process.uptime());
    const now = new Date().toUTCString();
    await sendMessage(
      chatId,
      '<b>Spectre AI — Server Status</b>\n\n' +
        'Status: online\n' +
        `Uptime: ${uptimeStr}\n` +
        `Registered chats: ${chatIds.size}\n` +
        `Queued messages: ${incomingMessages.length}\n` +
        `Time: ${now}`
    );
    return;
  }

  if (text.startsWith('/')) {
    await sendMessage(chatId, 'Unknown command. Send /help to see available commands.');
    return;
  }

  // Greetings — respond naturally without queuing
  if (GREETING_RE.test(text)) {
    const name = firstName ? ` ${firstName}` : '';
    await sendMessage(
      chatId,
      `Hey${name} — I'm Spectre's Telegram relay bot.\n\nSend /help to see what I can do, or just type a message to forward it to the Spectre dashboard.`
    );
    return;
  }

  // Any other message — queue it for the app and auto-register the sender
  chatIds.add(chatId);
  saveChatIds();
  queueMessage(chatId, username, text, msg.message_id, msg.date);
  const name = firstName ? ` ${firstName}` : '';
  await sendMessage(
    chatId,
    `Got it${name}. Your message has been queued for the Spectre dashboard.\n\n` +
      `<i>Message: "${text.length > 80 ? text.slice(0, 80) + '…' : text}"</i>`
  );
}

// ── Long polling loop ─────────────────────────────────────────────────────────

let pollingActive = false;

async function startPolling() {
  if (!BOT_TOKEN) {
    console.log('[Telegram] TELEGRAM_BOT_TOKEN not set — bot disabled');
    return;
  }
  if (pollingActive) return;
  pollingActive = true;
  loadChatIds();

  console.log('[Telegram] Bot polling started');

  let offset = 0;
  while (pollingActive) {
    try {
      const res = await fetch(
        `${API_BASE}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message"]`
      );
      const data = await res.json();

      if (!data.ok) {
        console.error('[Telegram] getUpdates error:', data.description);
        await sleep(5000);
        continue;
      }

      for (const update of data.result) {
        offset = update.update_id + 1;
        handleUpdate(update).catch(e =>
          console.error('[Telegram] Update handler error:', e.message)
        );
      }
    } catch (e) {
      // Network error or server restart — retry after delay
      console.error('[Telegram] Polling error:', e.message);
      await sleep(5000);
    }
  }
}

function stopPolling() {
  pollingActive = false;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  sendMessage,
  broadcastMessage,
  startPolling,
  stopPolling,
  getIncomingMessages,
  getChatCount: () => chatIds.size,
};
