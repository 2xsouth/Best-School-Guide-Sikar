// ============================================================
//  Best School Guide Sikar — public config
// ============================================================
//  IMPORTANT: Only the SUPABASE URL and the ANON PUBLIC key go here.
//  These are SAFE to expose in the browser — that is what they are for.
//  Row-Level Security (RLS) on the database is what keeps data safe:
//  with these keys a visitor can ONLY read published blog posts.
//
//  NEVER put the service_role key, the Gemini key, or the Telegram
//  token in this file or anywhere in the website. Those live ONLY in
//  Supabase Edge Function secrets (server side).
// ============================================================

window.BSG_CONFIG = {
  // From Supabase -> Project Settings -> API
  SUPABASE_URL: "PASTE_YOUR_PROJECT_URL_HERE",     // e.g. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: "PASTE_YOUR_ANON_PUBLIC_KEY_HERE"
};

// Enabled only when real values are filled in. Until then the site
// shows the built-in demo posts so nothing looks broken.
window.BSG_CONFIG.ENABLED =
  window.BSG_CONFIG.SUPABASE_URL.indexOf("http") === 0 &&
  window.BSG_CONFIG.SUPABASE_ANON_KEY.length > 20;
