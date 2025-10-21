// whatsapp/apiListener.js

import express from 'express';
import { sendMessage } from './sender.js';

const app = express();
const port = process.env.BOT_API_PORT || 3001;

app.use(express.json());

/**
 * A helper function that processes and sends a single message payload using Baileys.
 * This is the core logic for each message.
 * @param {{ userPhone: string; mssg: string }} messagePayload
 */
async function processSingleMessage(messagePayload) {
  const { userPhone, mssg } = messagePayload;

  // Basic validation for the payload
  if (!userPhone || !mssg) {
    return { success: false, error: 'Invalid message object', for: userPhone || 'unknown', status: 400 };
  }

  try {
    const baileysResult = await sendMessage(userPhone, mssg);

    if (!baileysResult) {
      return { success: false, error: 'Bot failed to send message', for: userPhone, status: 500 };
    }

    return { success: true, data: baileysResult, for: userPhone, status: 200 };
  } catch (error) {
    console.error(`[Bot API] Internal error for ${userPhone}:`, error.message);
    return { success: false, error: 'An internal error occurred in the bot service.', for: userPhone, status: 500 };
  }
}


/**
 * Main API endpoint that intelligently handles both single and bulk message requests.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleRequest(req, res) {
  try {
    const body = req.body;

    // Case 1: Handle bulk requests (body is an array)
    if (Array.isArray(body)) {
      console.log(`[Bot API] Handling bulk request with ${body.length} messages.`);
      // Use Promise.all to send all messages concurrently for better performance
      const results = await Promise.all(body.map(processSingleMessage));
      return res.status(200).json({ success: true, results });
    }

    // Case 2: Handle single message requests (body is an object)
    if (typeof body === 'object' && body !== null) {
      console.log(`[Bot API] Handling single message request for ${body.userPhone}.`);
      const result = await processSingleMessage(body);
      return res.status(result.status).json(result);
    }

    // Case 3: Invalid request body format
    return res.status(400).json({ success: false, error: 'Invalid request body. Expected a JSON object or an array.' });

  } catch (error) {
    // This catch is for unexpected server errors, not JSON parsing,
    // as express.json() handles that.
    console.error('[Bot API] A critical error occurred:', error.message);
    return res.status(500).json({ success: false, error: 'An unexpected server error occurred.' });
  }
}

// Using a single, flexible endpoint.
app.post('/api/webhook/whatsapp', handleRequest);

export const startApiListener = () => {
  app.listen(port, () => {
    console.log(`🤖 Bot's internal API is listening on http://localhost:${port}`);
  });
};