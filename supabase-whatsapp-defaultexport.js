// whatsapp/supabase-whatsapp-defaultexport.js

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

// This configuration is designed to run from the root of your project
// where the .env.local file is located.
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('DEBUG: supabase env ->', {
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? 'LOADED' : supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey ? 'LOADED' : supabaseServiceRoleKey
});

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY). Check .env.local');
}

const serviceSupabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export default serviceSupabase;