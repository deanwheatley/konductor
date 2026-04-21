/// <reference types="node" />
import { defineConfig } from "@playwright/test";

// Prevent Konductor's main() from auto-starting when we import server modules
process.env.VITEST = "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
