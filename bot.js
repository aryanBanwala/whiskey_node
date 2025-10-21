// whatsapp/bot.js

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import { handleMessage } from './handler.js'; // Ensure .js extension
import * as fs from 'fs';
import { setSocket } from './socketManager.js';
import qrcode from 'qrcode-terminal';

const SESSION_DIR = './session';

// This function will now handle the entire connection lifecycle.
const connectToWhatsApp = async () => {
  // Ensure session directory exists
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Using Baileys version ${version.join('.')}, isLatest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  // Update the global socket every time we create a new one.
  setSocket(sock);

  // Event listener for connection updates
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('------------------------------------------------');
      console.log('SCAN THIS QR CODE TO CONNECT YOUR WHATSAPP');
      qrcode.generate(qr, { small: true });
      console.log('------------------------------------------------');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
      // Reconnect if it's not a logout error
      if (shouldReconnect) {
        connectToWhatsApp();
      } else {
        console.log('Connection closed. You are logged out. Please delete the session folder and restart.');
        if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        }
      }
    } else if (connection === 'open') {
      console.log('✅ Connection opened!');
    }
  });

  // Event listener for saving credentials
  sock.ev.on('creds.update', saveCreds);

  // Event listener for incoming messages
  sock.ev.on('messages.upsert', async (m) => {
    handleMessage(sock, m);
  });
};

// Export the connect function as startBot
export const startBot = connectToWhatsApp;