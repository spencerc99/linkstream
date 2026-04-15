import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { glob } from "glob";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Fix the port so OAuth redirect URIs stored in IndexedDB don't drift
    // between dev sessions. Fail loudly instead of auto-picking a new port.
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: glob.sync(path.resolve(__dirname, "*.html")),
    },
    emptyOutDir: true,
  },
});
