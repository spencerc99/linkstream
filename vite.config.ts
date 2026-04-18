import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { glob } from "glob";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to IPv4 loopback explicitly. Matches the 127.0.0.1 hostname
    // required by AT Proto OAuth for loopback redirect URIs.
    host: "127.0.0.1",
  },
  build: {
    rollupOptions: {
      input: glob.sync(path.resolve(__dirname, "*.html")),
    },
    emptyOutDir: true,
  },
});
