import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Development server only; production builds use scripts/build-client.mjs.

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 5050}` },
  },
});
