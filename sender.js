// whatsapp/sender.js

import { getSocket } from './socketManager.js';

const delay = (ms) => new Promise(res => setTimeout(res, ms));

// This map will store the active typing intervals and timeouts for each JID.
const activeTyping = new Map();

/**
 * Starts showing a "typing..." presence update.
 * @param {string} jid The recipient's JID.
 * @param {number} [durationMs] Optional duration to type for in milliseconds.
 */
export const startTyping = async (jid, durationMs) => {
  const sock = getSocket();
  const fullJid = jid.endsWith('@s.whatsapp.net') ? jid : `${jid}@s.whatsapp.net`;

  if (activeTyping.has(fullJid)) {
    // If already typing, just reset the auto-stop timer if provided
    const entry = activeTyping.get(fullJid);
    if (entry.timeout) {
      clearTimeout(entry.timeout);
    }
    if (durationMs) {
      entry.timeout = setTimeout(() => stopTyping(fullJid), durationMs);
    }
    return;
  }

  try {
    await sock.sendPresenceUpdate('composing', fullJid);

    const interval = setInterval(() => {
      sock.sendPresenceUpdate('composing', fullJid).catch(() => {});
    }, 150);

    let timeout = undefined;
    if (durationMs) {
      timeout = setTimeout(() => stopTyping(fullJid), durationMs);
    }

    activeTyping.set(fullJid, { interval, timeout });

  } catch (error) {
    console.error(`Error starting typing for ${fullJid}:`, error);
  }
};

/**
 * Stops the "typing..." presence update immediately.
 * @param {string} jid The recipient's JID.
 */
export const stopTyping = async (jid) => {
  const sock = getSocket();
  const fullJid = jid.endsWith('@s.whatsapp.net') ? jid : `${jid}@s.whatsapp.net`;

  const entry = activeTyping.get(fullJid);
  if (entry) {
    clearInterval(entry.interval);
    if (entry.timeout) {
      clearTimeout(entry.timeout);
    }
    activeTyping.delete(fullJid);
  }

  try {
    // Send one final 'paused' update to clear the indicator
    await sock.sendPresenceUpdate('paused', fullJid);
  } catch (error) {
    console.error(`Error stopping typing for ${fullJid}:`, error);
  }
};

/**
 * Sends a text message to a given JID.
 * @param {string} jid The recipient's JID (e.g., '1234567890').
 * @param {string} text The message text to send.
 * @returns {Promise<import('@whiskeysockets/baileys').proto.WebMessageInfo | null>}
 */
export const sendMessage = async (jid, text) => {
  const sock = getSocket();
  const fullJid = jid.endsWith('@s.whatsapp.net') ? jid : `${jid}@s.whatsapp.net`;

  await delay(Math.random() * 500 + 250); // to wait if the previous typing is still there
  await startTyping(fullJid);
  await delay(Math.random() * 1000 + 750);

  try {
    const message = await sock.sendMessage(fullJid, { text: text });
    console.log(`✉️  Sent message to ${fullJid}: "${text}"`);
    await stopTyping(fullJid);
    return message;
  } catch (error) {
    console.error(`Error sending message to ${fullJid}:`, error);
    await stopTyping(fullJid);
    return null;
  }
};