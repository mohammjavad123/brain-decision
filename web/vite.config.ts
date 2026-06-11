import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The UI runs on :5173 and proxies the agent API (GET /ask SSE, POST /resolve) to the
// Node API server on :8787 — so the browser talks to one origin and SSE streams cleanly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ask": { target: "http://localhost:8787", changeOrigin: true },
      "/resolve": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
