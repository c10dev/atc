import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 7700,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:7701" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
