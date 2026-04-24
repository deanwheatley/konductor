import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import { FileSettingsBackend } from "./file-settings-backend.js";

describe("FileSettingsBackend", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-settings-"));
    filePath = join(tempDir, "settings.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null for missing key", async () => {
    const backend = new FileSettingsBackend(filePath);
    expect(await backend.getSetting("nope")).toBeNull();
  });

  it("round-trips a setting through set and get", async () => {
    const backend = new FileSettingsBackend(filePath);
    await backend.setSetting("foo", '"bar"', "system");
    expect(await backend.getSetting("foo")).toBe('"bar"');
  });

  it("persists settings to disk after flush", async () => {
    const backend = new FileSettingsBackend(filePath, 60000); // long debounce
    await backend.setSetting("key1", '"val1"', "system");
    await backend.setSetting("key2", '"val2"', "slack");
    await backend.flush();

    const raw = await readFile(filePath, "utf-8");
    const records = JSON.parse(raw);
    expect(records).toHaveLength(2);
    expect(records.find((r: any) => r.key === "key1").value).toBe('"val1"');
    expect(records.find((r: any) => r.key === "key2").value).toBe('"val2"');
  });

  it("loads settings from an existing file on first access", async () => {
    // Seed the file
    const seed = [
      { key: "a", value: '"hello"', category: "system", updatedAt: "2026-01-01T00:00:00.000Z" },
      { key: "b", value: "42", category: "slack", updatedAt: "2026-01-01T00:00:00.000Z" },
    ];
    writeFileSync(filePath, JSON.stringify(seed));

    const backend = new FileSettingsBackend(filePath);
    expect(await backend.getSetting("a")).toBe('"hello"');
    expect(await backend.getSetting("b")).toBe("42");
  });

  it("survives a simulated restart (write, new instance, read)", async () => {
    const b1 = new FileSettingsBackend(filePath);
    await b1.setSetting("persist", '"yes"', "system");
    await b1.flush();

    // New instance — simulates server restart
    const b2 = new FileSettingsBackend(filePath);
    expect(await b2.getSetting("persist")).toBe('"yes"');
  });

  it("getAllSettings returns all records, optionally filtered by category", async () => {
    const backend = new FileSettingsBackend(filePath);
    await backend.setSetting("s1", '"v1"', "system");
    await backend.setSetting("s2", '"v2"', "slack");
    await backend.setSetting("s3", '"v3"', "system");

    const all = await backend.getAllSettings();
    expect(all).toHaveLength(3);

    const systemOnly = await backend.getAllSettings("system");
    expect(systemOnly).toHaveLength(2);
    expect(systemOnly.every((r) => r.category === "system")).toBe(true);
  });

  it("backs up corrupted file and starts fresh", async () => {
    writeFileSync(filePath, "NOT VALID JSON {{{");

    const backend = new FileSettingsBackend(filePath);
    const result = await backend.getSetting("anything");
    expect(result).toBeNull();

    // Backup should exist
    const { existsSync } = await import("node:fs");
    expect(existsSync(`${filePath}.backup`)).toBe(true);
  });

  it("backs up non-array JSON and starts fresh", async () => {
    writeFileSync(filePath, JSON.stringify({ not: "an array" }));

    const backend = new FileSettingsBackend(filePath);
    expect(await backend.getSetting("anything")).toBeNull();
  });

  it("skips invalid records during load", async () => {
    const seed = [
      { key: "good", value: '"ok"', category: "system", updatedAt: "2026-01-01T00:00:00.000Z" },
      { key: 123, value: "bad" }, // invalid — key is not a string
    ];
    writeFileSync(filePath, JSON.stringify(seed));

    const backend = new FileSettingsBackend(filePath);
    expect(await backend.getSetting("good")).toBe('"ok"');
    const all = await backend.getAllSettings();
    expect(all).toHaveLength(1);
  });

  it("overwrites existing key on re-set", async () => {
    const backend = new FileSettingsBackend(filePath);
    await backend.setSetting("x", '"old"', "system");
    await backend.setSetting("x", '"new"', "system");
    expect(await backend.getSetting("x")).toBe('"new"');

    await backend.flush();
    const b2 = new FileSettingsBackend(filePath);
    expect(await b2.getSetting("x")).toBe('"new"');
  });

  it("handles missing file gracefully (no error)", async () => {
    const backend = new FileSettingsBackend(join(tempDir, "nonexistent.json"));
    expect(await backend.getSetting("x")).toBeNull();
    expect(await backend.getAllSettings()).toEqual([]);
  });
});
