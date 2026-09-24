import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Single source of truth for the app version shown in the UI (P1-7).
const appVersion: string = JSON.parse(readFileSync("./package.json", "utf-8")).version;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },

  build: {
    // Rich-text vendor libs (highlight.js/marked/dompurify) split out — cached separately
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          richtext: ['highlight.js/lib/common', 'marked', 'dompurify'],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
