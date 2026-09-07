import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { recipeBookMiddleware } from './lib/taste/recipe-book.mjs';

export default defineConfig({
  base: process.env.TASTE_BASE_PATH || "/",
  // Recipe saves return updated data through the API; a full page reload would
  // interrupt the save response and discard the editor's connection state.
  server: { watch: { ignored: ['**/catalog/**'] } },
  plugins: [tailwindcss(), react(), {
    name: "kitchen-artifact-headers",
    configureServer(server) {
      server.middlewares.use(recipeBookMiddleware(process.cwd()));
      server.middlewares.use((request, response, next) => {
        if (request.url?.includes("/dishes/")) {
          response.setHeader("Access-Control-Allow-Origin", "*");
          response.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'");
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api/votes')) return next();
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ mode: 'local' }));
      });
    },
  }],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
