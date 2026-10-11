import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Auf GitHub Pages liegt die App unter /skript-frage/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/skript-frage/",
});
