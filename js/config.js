/* ══════════════════════════════════════════════════════════════
   Supabase client — created once, used everywhere as `sb`
   Loaded in <head> AFTER the Supabase CDN script.
══════════════════════════════════════════════════════════════ */
const sb = window.supabase.createClient(
    'https://iymmfwjsmaziymmwijjn.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5bW1md2pzbWF6aXltbXdpampuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MDA4NjEsImV4cCI6MjA4ODI3Njg2MX0.caAHy7Ie28m17akWRL98Zisoi91FJLtKkpwStmLjSh0'
);
