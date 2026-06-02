import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { glob } from "glob";

const METADATA_PLACEHOLDER = "https://REPLACE_WITH_DEPLOYED_ORIGIN";

// Bakes the deployed origin into dist/client-metadata.json. AT Proto requires
// client_id/redirect_uris to be absolute HTTPS URLs matching the serving
// origin exactly, so the committed public/client-metadata.json keeps a
// placeholder and the real origin is substituted at build time.
//
// Origin resolves from VITE_OAUTH_ORIGIN (set this once a custom domain is
// attached) or CF_PAGES_URL (Cloudflare Pages sets this automatically to the
// *.pages.dev origin, so the first deploy works with no config). With neither
// set (plain local build) the placeholder is left untouched.
function bakeClientMetadataOrigin(): Plugin {
  return {
    name: "bake-client-metadata-origin",
    apply: "build",
    closeBundle() {
      const rawOrigin =
        process.env.VITE_OAUTH_ORIGIN || process.env.CF_PAGES_URL;
      if (!rawOrigin) return;

      const origin = rawOrigin.replace(/\/$/, "");
      const distFile = path.resolve(__dirname, "dist/client-metadata.json");
      if (!fs.existsSync(distFile)) return;

      const contents = fs.readFileSync(distFile, "utf8");
      fs.writeFileSync(
        distFile,
        contents.replaceAll(METADATA_PLACEHOLDER, origin)
      );
      // eslint-disable-next-line no-console
      console.log(`client-metadata.json origin baked as ${origin}`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), bakeClientMetadataOrigin()],
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
