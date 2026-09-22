'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let client = null;

if (supabaseUrl && supabaseKey) {
  try {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    console.log('[supabase] Supabase client initialized successfully.');
  } catch (err) {
    console.error('[supabase] Initialization error:', err.message);
  }
} else {
  console.log('[supabase] Supabase environment variables (SUPABASE_URL, SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) not provided. Running in local SQLite mode.');
}

function getClient() {
  return client;
}

function isConfigured() {
  return !!client;
}

module.exports = {
  getClient,
  isConfigured,
  supabase: client
};
