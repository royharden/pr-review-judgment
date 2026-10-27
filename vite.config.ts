import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static viewer only (M6). It renders public dev corpus records and MOCK fixtures through src/core; it never
// imports held-out data, private companions or hidden tests. Not yet built (DEFERRED-VALIDATION DV-09).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
