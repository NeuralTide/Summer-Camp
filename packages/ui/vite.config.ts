import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.METAHARNESS_API ?? "http://127.0.0.1:5273";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5274,
    // In dev the UI is served by Vite, so API calls proxy to the daemon.
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: false,
        // SSE must not be buffered or the build log arrives all at once at the end.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              delete proxyRes.headers["content-length"];
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
