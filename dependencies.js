// dependencies.js

import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';

// Check if API keys are available
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('Missing API key. Please add OPENROUTER_API_KEY to your .env.local file');
}

// Configure OpenRouter using OpenAI SDK
export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    // These headers help OpenRouter identify your app
    "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    "X-Title": "RelationshipOS", // Or whatever you'd like to call your project
  }
});

// For backward compatibility, you can also export it as portkey
export const portkey = openrouter;