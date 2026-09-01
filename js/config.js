
window.BSG_CONFIG = {
  SUPABASE_URL: "https://axswincjhsbwqgfgdicn.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4c3dpbmNqaHNid3FnZmdkaWNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MTcwMTksImV4cCI6MjEwMzI5MzAxOX0.97rjxtKlg2OMLiqxjLRzd6DObnbczSJbrafI6PfhbQI"
};

window.BSG_CONFIG.ENABLED =
  window.BSG_CONFIG.SUPABASE_URL.indexOf("http") === 0 &&
  window.BSG_CONFIG.SUPABASE_ANON_KEY.length > 20;
