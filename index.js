// whatsapp/index.js

// Load environment variables FIRST, before any other imports
import { config } from 'dotenv';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
console.log('Loading .env from:', envPath);
config({ path: envPath });

// Debug: Check if environment variables are loaded
console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'LOADED' : 'MISSING');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'LOADED' : 'MISSING');
console.log('PINECONE_API_KEY:', process.env.PINECONE_API_KEY ? 'LOADED' : 'MISSING');
console.log('OPENROUTER_API_KEY:', process.env.OPENROUTER_API_KEY ? 'LOADED' : 'MISSING');
console.log('WHATSAPP_QUEUE_TEXT from env :', process.env.WHATSAPP_QUEUE_TEXT);

// Use dynamic imports so dotenv runs before any module is evaluated
const { startBot } = await import('./bot.js');
const { startApiListener } = await import('./apiListener.js');

async function main() {
  try {
    console.log("Starting the WhatsApp bot...");
    await startBot();
    console.log("🚀 Bot started and socket is managed globally.");

    // Start the internal API listener
    startApiListener();

  } catch (error) {
    console.error("❌ Failed to start the bot:", error);
    process.exit(1);
  }
}

main();