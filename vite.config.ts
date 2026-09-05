import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.TASTE_BASE_PATH || "/",
  plugins: [react(), {
    name: "kitchen-artifact-headers",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.includes("/dishes/")) {
          response.setHeader("Access-Control-Allow-Origin", "*");
          response.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'");
        }
        next();
      });
    },
  }],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
