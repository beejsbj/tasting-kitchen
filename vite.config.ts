import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect } from "vite";
import { recipeBookMiddleware } from './lib/taste/recipe-book.mjs';
import { verdictMiddleware } from './lib/taste/verdicts.mjs';

// Local servers keep votes in browser storage; hosted deployments supply the API.
const localVoteFallback: Connect.NextHandleFunction = (request, response, next) => {
  if (!request.url?.startsWith('/api/votes')) return next();
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ mode: 'local' }));
};

// Mirrors the /dishes/ rule in vercel.json and deploy/nginx.conf so the dev and
// preview servers exercise the same artifact hosting contract.
// Vite decodes the path before serving, so match the decoded pathname: /dishes%2Fid/ must not escape the sandbox.
// An undecodable path is sandboxed too.
function isArtifactPath(url = "") {
  // Not new URL(): it reads "//dishes/x" as a host and drops the segment.
  const pathname = url.split(/[?#]/u, 1)[0];
  try { return decodeURIComponent(pathname).includes("/dishes/"); } catch { return true; }
}

const artifactHeaders: Connect.NextHandleFunction = (request, response, next) => {
  if (isArtifactPath(request.url)) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
  }
  next();
};

export default defineConfig({
  base: process.env.TASTE_BASE_PATH || "/",
  // Recipe saves return updated data through the API; a full page reload would
  // interrupt the save response and discard the editor's connection state.
  server: { watch: { ignored: ['**/catalog/**'] } },
  plugins: [tailwindcss(), react(), {
    name: "kitchen-artifact-headers",
    configureServer(server) {
      server.middlewares.use(localVoteFallback);
      server.middlewares.use(recipeBookMiddleware(process.cwd()));
      // Burooj's verdicts write beside Dishes from local development, loopback same-origin only.
      server.middlewares.use(verdictMiddleware(process.cwd()));
      server.middlewares.use(artifactHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(localVoteFallback);
      server.middlewares.use(artifactHeaders);
    },
  }],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
