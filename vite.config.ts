import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Fix: Cast process to any to avoid TS error "Property 'cwd' does not exist on type 'Process'"
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      'process.env': {
        // Fallbacks for build-time (prevent crashes), actual values come from window.env at runtime
        API_KEY: JSON.stringify(""),
        googlecloud_clientid: JSON.stringify(""),
        GOOGLE_CLIENT_ID: JSON.stringify(""),
        VITE_SUPABASE_URL: JSON.stringify(""),
        VITE_SUPABASE_ANON_KEY: JSON.stringify(""),
        ADMIN_EMAIL: JSON.stringify("")
      }
    }
  };
});