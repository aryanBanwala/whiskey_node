// whatsapp/socketManager.js

let sock = null;

/**
 * Sets the global socket instance. This should be called once after the bot connects.
 * @param {import('@whiskeysockets/baileys').WASocket} newSock The active WhatsApp socket instance.
 */
export const setSocket = (newSock) => {
  console.log("✅ Socket instance has been set in the manager.");
  sock = newSock;
};

/**
 * Retrieves the global socket instance.
 * @returns {import('@whiskeysockets/baileys').WASocket} The active WhatsApp socket instance.
 * @throws {Error} If the socket has not been initialized.
 */
export const getSocket = () => {
  if (!sock) {
    throw new Error("Socket not initialized. Call setSocket first.");
  }
  return sock;
};