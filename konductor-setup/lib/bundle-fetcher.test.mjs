import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

// --- Mock node:http ---

function createMockResponse(statusCode, body) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  // Emit data + end on next tick so the listener is attached first
  process.nextTick(() => {
    res.emit("data", Buffer.from(body));
    res.emit("end");
  });
  return res;
}

function createMockRequest(response) {
  const req = new EventEmitter();
  req.destroy = vi.fn();
  // Simulate the callback with the response on next tick
  if (response instanceof Error) {
    process.nextTick(() => req.emit("error", response));
  }
  return req;
}

let httpGetHandler;

vi.mock("node:http", () => ({
  default: {
    get: (url, opts, cb) => {
      return httpGetHandler(url, opts, cb);
    },
  },
  get: (url, opts, cb) => {
    return httpGetHandler(url, opts, cb);
  },
}));

vi.mock("node:https", () => ({
  default: {
    get: (url, opts, cb) => {
      return httpGetHandler(url, opts, cb);
    },
  },
  get: (url, opts, cb) => {
    return httpGetHandler(url, opts, cb);
  },
}));

// Import after mocks are set up
const { fetchBundle } = await import("./bundle-fetcher.mjs");

describe("fetchBundle", () => {
  beforeEach(() => {
    httpGetHandler = undefined;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns server source when manifest and all files download successfully", async () => {
    const manifest = {
      version: "1.2.3",
      files: ["konductor-watcher.mjs", "kiro/settings/mcp.json"],
    };

    const fileContents = {
      "konductor-watcher.mjs": "// watcher code",
      "kiro/settings/mcp.json": '{"mcpServers":{}}',
    };

    httpGetHandler = (url, opts, cb) => {
      const req = new EventEmitter();
      req.destroy = vi.fn();

      process.nextTick(() => {
        if (url.includes("/bundle/manifest.json")) {
          cb(createMockResponse(200, JSON.stringify(manifest)));
        } else if (url.includes("/bundle/files/")) {
          const filePath = url.split("/bundle/files/")[1];
          cb(createMockResponse(200, fileContents[filePath] || ""));
        }
      });

      return req;
    };

    const result = await fetchBundle("http://localhost:3010");

    expect(result.source).toBe("server");
    expect(result.version).toBe("1.2.3");
    expect(existsSync(result.bundleDir)).toBe(true);
    // Verify downloaded files exist
    expect(
      readFileSync(join(result.bundleDir, "konductor-watcher.mjs"), "utf-8")
    ).toBe("// watcher code");
    expect(
      readFileSync(join(result.bundleDir, "kiro/settings/mcp.json"), "utf-8")
    ).toBe('{"mcpServers":{}}');

    // Cleanup
    rmSync(result.bundleDir, { recursive: true, force: true });
  });

  it("falls back to embedded when server is unreachable (connection error)", async () => {
    httpGetHandler = (url, opts, cb) => {
      const req = new EventEmitter();
      req.destroy = vi.fn();
      process.nextTick(() => req.emit("error", new Error("ECONNREFUSED")));
      return req;
    };

    const result = await fetchBundle("http://localhost:9999");

    expect(result.source).toBe("embedded");
    expect(result.bundleDir).toContain("bundle");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not reach server")
    );
  });

  it("falls back to embedded on request timeout", async () => {
    httpGetHandler = (url, opts, cb) => {
      const req = new EventEmitter();
      req.destroy = vi.fn();
      // Simulate timeout
      process.nextTick(() => req.emit("timeout"));
      return req;
    };

    const result = await fetchBundle("http://localhost:3010");

    expect(result.source).toBe("embedded");
    expect(req => req.destroy).toBeDefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not reach server")
    );
  });

  it("falls back to embedded when manifest returns non-200 status", async () => {
    httpGetHandler = (url, opts, cb) => {
      const req = new EventEmitter();
      req.destroy = vi.fn();
      process.nextTick(() => {
        cb(createMockResponse(500, "Internal Server Error"));
      });
      return req;
    };

    const result = await fetchBundle("http://localhost:3010");

    expect(result.source).toBe("embedded");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Server returned 500")
    );
  });

  it("falls back to embedded when file download fails after manifest succeeds", async () => {
    const manifest = {
      version: "1.0.0",
      files: ["konductor-watcher.mjs", "missing-file.txt"],
    };

    httpGetHandler = (url, opts, cb) => {
      const req = new EventEmitter();
      req.destroy = vi.fn();

      process.nextTick(() => {
        if (url.includes("/bundle/manifest.json")) {
          cb(createMockResponse(200, JSON.stringify(manifest)));
        } else if (url.includes("konductor-watcher.mjs")) {
          cb(createMockResponse(200, "// watcher"));
        } else if (url.includes("missing-file.txt")) {
          cb(createMockResponse(404, "Not Found"));
        }
      });

      return req;
    };

    const result = await fetchBundle("http://localhost:3010");

    expect(result.source).toBe("embedded");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("File download failed")
    );
  });

  it("embedded fallback reads from correct ../bundle/ path", async () => {
    httpGetHandler = (url, opts, cb) => {
      const req = new EventEmitter();
      req.destroy = vi.fn();
      process.nextTick(() => req.emit("error", new Error("ECONNREFUSED")));
      return req;
    };

    const result = await fetchBundle("http://localhost:9999");

    expect(result.source).toBe("embedded");
    // The bundleDir should end with /bundle
    expect(result.bundleDir).toMatch(/bundle$/);
    // And it should actually exist on disk (the embedded bundle is part of the package)
    expect(existsSync(result.bundleDir)).toBe(true);
  });
});
