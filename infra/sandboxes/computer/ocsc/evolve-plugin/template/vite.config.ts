import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Evolve runs a plugin as one script and one stylesheet with no network, so everything
// (images, fonts, lazy code) is inlined into those two files. Change nothing here.
export default defineConfig({
  plugins: [react()],
  base: "./",
  cacheDir: ".vite-cache",
  server: { host: "127.0.0.1", port: 5173, strictPort: false },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "assets/index.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
