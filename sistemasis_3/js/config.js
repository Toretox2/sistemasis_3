const supabaseUrl = 'https://olwqpstvsyzuzpdziwyd.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sd3Fwc3R2c3l6dXpwZHppd3lkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3Nzg1MzUsImV4cCI6MjEwMzM1NDUzNX0.5Z2d3HMHvp0iSUKwxNtkjHF4xCwBAYMIlqoYkmjpdsM';

const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

window.AuraTechSupabase = supabase;
