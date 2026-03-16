import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8033,
    allowedHosts: [".ngrok.app", ".ngrok.dev", ".ngrok.io"],
    proxy: {
      "/api": {
        target: "http://localhost:8034",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8034",
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
