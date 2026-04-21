import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { KonductorLogger } from "./logger.js";
import type { LogEntry, LogCategory } from "./logger.js";
import { appendFileSync, statSync, unlinkSync, renameSync } from "node:fs";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  renameSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const categoryArb: fc.Arbitrary<LogCategory> = fc.constantFrom(
  "CONN", "SESSION", "STATUS", "CONFIG", "SERVER", "QUERY", "GITHUB",
);

const timestampArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 }),
  )
  .map(([y, mo, d, h, mi, s]) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
  });

const userIdArb = fc.stringMatching(/^[a-zA-Z0-9_]{1,20}$/);

const actorArb: fc.Arbitrary<string> = fc.oneof(
  userIdArb.map((id) => `User: ${id}`),
  fc.constant("SYSTEM"),
  fc.stringMatching(/^[a-f0-9]{1,8}$/).map((id) => `Transport: ${id}`),
);

/** Message must not contain newlines or be empty, and must not start/end with whitespace. */
const messageArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9 .,;:!?/\-_()@#=+]{1,80}$/)
  .filter((s) => s.trim().length > 0 && !s.includes("\n"));

const logEntryArb: fc.Arbitrary<LogEntry> = fc
  .record({
    timestamp: timestampArb,
    category: categoryArb,
    actor: actorArb,
    message: messageArb,
  });

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("KonductorLogger — Property Tests", () => {
  const logger = new KonductorLogger({ enabled: true, toTerminal: false });

  /**
   * **Feature: konductor-logging, Property 1: Log format consistency**
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   */
  it("Property 1: Log format consistency", () => {
    const FORMAT_REGEX = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[(CONN|SESSION|STATUS|CONFIG|SERVER|QUERY|GITHUB)\] \[(User: [^\]]+|SYSTEM|Transport: [^\]]+)\] .+$/;

    fc.assert(
      fc.property(logEntryArb, (entry) => {
        const formatted = logger.formatEntry(entry);
        expect(formatted).toMatch(FORMAT_REGEX);
        expect(formatted).toContain(`[${entry.timestamp}]`);
        expect(formatted).toContain(`[${entry.category}]`);
        expect(formatted).toContain(`[${entry.actor}]`);
        expect(formatted).toContain(entry.message);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-logging, Property 2: Log entry round-trip**
   * **Validates: Requirements 2.5**
   */
  it("Property 2: Log entry round-trip", () => {
    fc.assert(
      fc.property(logEntryArb, (entry) => {
        const formatted = logger.formatEntry(entry);
        const parsed = logger.parseEntry(formatted);
        expect(parsed.timestamp).toBe(entry.timestamp);
        expect(parsed.category).toBe(entry.category);
        expect(parsed.actor).toBe(entry.actor);
        expect(parsed.message).toBe(entry.message);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-logging, Property 3: Registration log completeness**
   * **Validates: Requirements 4.1, 4.2**
   */
  it("Property 3: Registration log completeness", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const loggerWithOutput = new KonductorLogger({ enabled: true, toTerminal: true });

    const repoArb = fc.stringMatching(/^[a-z]{1,10}\/[a-z]{1,10}$/);
    const branchArb = fc.stringMatching(/^[a-z]{1,15}$/);
    const filePathArb = fc.stringMatching(/^[a-z]{1,8}\/[a-z]{1,8}\.[a-z]{1,4}$/);
    const filesArb = fc.array(filePathArb, { minLength: 1, maxLength: 5 });
    const sessionIdArb = fc.stringMatching(/^sess-[a-z0-9]{1,10}$/);

    fc.assert(
      fc.property(userIdArb, sessionIdArb, repoArb, branchArb, filesArb, (userId, sessionId, repo, branch, files) => {
        stderrSpy.mockClear();
        loggerWithOutput.logSessionRegistered(userId, sessionId, repo, branch, files);

        expect(stderrSpy).toHaveBeenCalledOnce();
        const output = stderrSpy.mock.calls[0][0] as string;

        expect(output).toContain(`[User: ${userId}]`);
        expect(output).toContain(sessionId);
        expect(output).toContain(repo);
        expect(output).toContain(branch);
        for (const file of files) {
          expect(output).toContain(file);
        }
        expect(output).toContain("[SESSION]");
      }),
      { numRuns: 100 },
    );

    stderrSpy.mockRestore();
  });

  /**
   * **Feature: konductor-logging, Property 4: Collision log completeness by severity**
   * **Validates: Requirements 5.1, 5.2, 5.3**
   */
  it("Property 4: Collision log completeness by severity", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const loggerWithOutput = new KonductorLogger({ enabled: true, toTerminal: true });

    const repoArb = fc.stringMatching(/^[a-z]{1,10}\/[a-z]{1,10}$/);
    const stateArb = fc.constantFrom("solo", "neighbors", "crossroads", "collision_course", "merge_hell");
    const filePathArb = fc.stringMatching(/^[a-z]{1,8}\/[a-z]{1,8}\.[a-z]{1,4}$/);
    const branchArb = fc.stringMatching(/^[a-z]{1,15}$/);

    const NEIGHBORS_OR_HIGHER = new Set(["neighbors", "crossroads", "collision_course", "merge_hell"]);
    const HIGH_SEVERITY = new Set(["collision_course", "merge_hell"]);

    fc.assert(
      fc.property(
        userIdArb, repoArb, stateArb,
        fc.array(userIdArb, { minLength: 1, maxLength: 3 }),
        fc.array(filePathArb, { minLength: 1, maxLength: 3 }),
        fc.array(branchArb, { minLength: 1, maxLength: 2 }),
        (userId, repo, state, overlappingUsers, sharedFiles, branches) => {
          stderrSpy.mockClear();

          const users = NEIGHBORS_OR_HIGHER.has(state) ? overlappingUsers : [];
          const files = HIGH_SEVERITY.has(state) ? sharedFiles : [];
          const branchList = HIGH_SEVERITY.has(state) ? branches : [];

          loggerWithOutput.logCollisionState(userId, repo, state, users, files, branchList);

          expect(stderrSpy).toHaveBeenCalledOnce();
          const output = stderrSpy.mock.calls[0][0] as string;

          // Always present: userId, repo, state
          expect(output).toContain(`[User: ${userId}]`);
          expect(output).toContain(repo);
          expect(output).toContain(state);
          expect(output).toContain("[STATUS]");

          // Neighbors or higher: overlapping users
          if (NEIGHBORS_OR_HIGHER.has(state)) {
            for (const u of users) {
              expect(output).toContain(u);
            }
          }

          // Collision Course or Merge Hell: shared files and branches
          if (HIGH_SEVERITY.has(state)) {
            for (const f of files) {
              expect(output).toContain(f);
            }
            for (const b of branchList) {
              expect(output).toContain(b);
            }
          }
        },
      ),
      { numRuns: 100 },
    );

    stderrSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("KonductorLogger — Unit Tests", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("disabled logger produces no output", () => {
    const logger = new KonductorLogger({ enabled: false, toTerminal: true });
    logger.logConnection("alice", "192.168.1.1");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("enabled logger with toTerminal writes to stderr", () => {
    const logger = new KonductorLogger({ enabled: true, toTerminal: true });
    logger.logConnection("alice", "192.168.1.1", "alice-laptop.local");
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[CONN]");
    expect(output).toContain("[User: alice]");
    expect(output).toContain("192.168.1.1");
    expect(output).toContain("alice-laptop.local");
  });

  it("enabled logger with toTerminal=false produces no output", () => {
    const logger = new KonductorLogger({ enabled: true, toTerminal: false });
    logger.logConnection("alice", "192.168.1.1");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("parseEntry throws on malformed input", () => {
    const logger = new KonductorLogger({ enabled: true, toTerminal: false });
    expect(() => logger.parseEntry("not a log line")).toThrow("Malformed log entry");
    expect(() => logger.parseEntry("")).toThrow("Malformed log entry");
  });
});

// ---------------------------------------------------------------------------
// Event Method Unit Tests
// ---------------------------------------------------------------------------

describe("KonductorLogger — Event Methods", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let logger: KonductorLogger;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger = new KonductorLogger({ enabled: true, toTerminal: true });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  // -- Connection events (Req 3.1, 3.2, 3.3, 3.4) --

  it("connection log includes IP and hostname", () => {
    logger.logConnection("alice", "10.0.0.5", "alice-dev.local");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[CONN]");
    expect(output).toContain("[User: alice]");
    expect(output).toContain("10.0.0.5");
    expect(output).toContain("alice-dev.local");
  });

  it("connection log without hostname omits parenthetical", () => {
    logger.logConnection("bob", "10.0.0.6");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("10.0.0.6");
    expect(output).not.toContain("(");
  });

  it("authentication log confirms valid API key", () => {
    logger.logAuthentication("alice");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[CONN]");
    expect(output).toContain("[User: alice]");
    expect(output).toContain("Authenticated");
  });

  it("disconnection log indicates disconnect", () => {
    logger.logDisconnection("alice");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[CONN]");
    expect(output).toContain("[User: alice]");
    expect(output).toContain("Disconnected");
  });

  it("auth rejection log includes IP and reason", () => {
    logger.logAuthRejection("10.0.0.99", "invalid key");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[CONN]");
    expect(output).toContain("[SYSTEM]");
    expect(output).toContain("10.0.0.99");
    expect(output).toContain("invalid key");
  });

  // -- Session events (Req 4.1, 4.2, 4.3, 4.4, 4.5) --

  it("session registration log includes all fields", () => {
    logger.logSessionRegistered("bob", "sess-42", "org/repo", "feature-x", ["src/a.ts", "src/b.ts"]);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[SESSION]");
    expect(output).toContain("[User: bob]");
    expect(output).toContain("sess-42");
    expect(output).toContain("org/repo");
    expect(output).toContain("feature-x");
    expect(output).toContain("src/a.ts");
    expect(output).toContain("src/b.ts");
  });

  it("session update log includes session ID and files", () => {
    logger.logSessionUpdated("bob", "sess-42", ["src/c.ts"]);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[SESSION]");
    expect(output).toContain("sess-42");
    expect(output).toContain("src/c.ts");
  });

  it("session deregistration log includes user and session ID", () => {
    logger.logSessionDeregistered("bob", "sess-42");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[SESSION]");
    expect(output).toContain("[User: bob]");
    expect(output).toContain("sess-42");
  });

  it("stale cleanup log includes count and timeout", () => {
    logger.logStaleCleanup(3, 300);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[SESSION]");
    expect(output).toContain("[SYSTEM]");
    expect(output).toContain("3");
    expect(output).toContain("300");
  });

  // -- Status events (Req 5.1, 5.2, 5.3, 5.4) --

  it("status log at solo level includes user, repo, state", () => {
    logger.logCollisionState("alice", "org/repo", "solo", [], [], []);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[STATUS]");
    expect(output).toContain("[User: alice]");
    expect(output).toContain("org/repo");
    expect(output).toContain("solo");
  });

  it("status log at neighbors level includes overlapping users", () => {
    logger.logCollisionState("alice", "org/repo", "neighbors", ["bob", "carol"], [], []);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("bob");
    expect(output).toContain("carol");
    expect(output).toContain("overlapping");
  });

  it("collision log at collision_course includes shared files and branches", () => {
    logger.logCollisionState("alice", "org/repo", "collision_course", ["bob"], ["src/index.ts"], ["main"]);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("src/index.ts");
    expect(output).toContain("main");
    expect(output).toContain("bob");
  });

  it("collision action log includes action type and affected users", () => {
    logger.logCollisionAction("warn", ["alice", "bob"], "org/repo");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[STATUS]");
    expect(output).toContain("warn");
    expect(output).toContain("alice");
    expect(output).toContain("bob");
    expect(output).toContain("org/repo");
  });

  // -- Config events (Req 6.1, 6.2, 6.3) --

  it("config loaded log includes file path and timeout", () => {
    logger.logConfigLoaded("/etc/konductor.yaml", 300);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[CONFIG]");
    expect(output).toContain("[SYSTEM]");
    expect(output).toContain("/etc/konductor.yaml");
    expect(output).toContain("300");
  });

  it("config reloaded log includes changes", () => {
    logger.logConfigReloaded("timeout changed from 300 to 600");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[CONFIG]");
    expect(output).toContain("timeout changed from 300 to 600");
  });

  it("config error log includes reason and retaining message", () => {
    logger.logConfigError("YAML parse error at line 5");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[CONFIG]");
    expect(output).toContain("YAML parse error at line 5");
    expect(output).toContain("retaining previous config");
  });

  // -- Server events (Req 7.1, 7.2, 7.3) --

  it("server start log includes transport and verbose status", () => {
    logger.logServerStart("stdio");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[SERVER]");
    expect(output).toContain("[SYSTEM]");
    expect(output).toContain("stdio");
    expect(output).toContain("verbose logging enabled");
  });

  it("server start with SSE includes port", () => {
    logger.logServerStart("sse", 3001);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("sse");
    expect(output).toContain("3001");
  });

  it("sessions restored log includes count", () => {
    logger.logSessionsRestored(5);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[SERVER]");
    expect(output).toContain("5");
    expect(output).toContain("Restored");
  });

  it("health check log includes requester IP", () => {
    logger.logHealthCheck("192.168.1.100");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[SERVER]");
    expect(output).toContain("192.168.1.100");
  });

  // -- Query events (Req 8.1, 8.2) --

  it("check_status log includes user, repo, and state", () => {
    logger.logCheckStatus("alice", "org/repo", "neighbors");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[QUERY]");
    expect(output).toContain("[User: alice]");
    expect(output).toContain("org/repo");
    expect(output).toContain("neighbors");
  });

  it("list_sessions log includes repo and count", () => {
    logger.logListSessions("org/repo", 7);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[QUERY]");
    expect(output).toContain("org/repo");
    expect(output).toContain("7");
  });
});


// ---------------------------------------------------------------------------
// File Logging Unit Tests (Req 1.5, 1.6)
// ---------------------------------------------------------------------------

describe("KonductorLogger — File Logging", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const mockedAppendFileSync = vi.mocked(appendFileSync);

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockedAppendFileSync.mockClear();
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("writes to the specified file when file logging is enabled", () => {
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
      filePath: "custom.log",
    });

    logger.logServerStart("stdio");

    expect(mockedAppendFileSync).toHaveBeenCalledOnce();
    const [filePath, content] = mockedAppendFileSync.mock.calls[0];
    expect(filePath).toBe("custom.log");
    expect(content).toContain("[SERVER]");
    expect(content).toContain("stdio");
  });

  it("defaults to konductor.log when filePath is not provided", () => {
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
    });

    logger.logConnection("alice", "10.0.0.1");

    expect(mockedAppendFileSync).toHaveBeenCalledOnce();
    const [filePath] = mockedAppendFileSync.mock.calls[0];
    expect(filePath).toBe("konductor.log");
  });

  it("does not write to file when toFile is false", () => {
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: true,
      toFile: false,
    });

    logger.logConnection("alice", "10.0.0.1");

    expect(mockedAppendFileSync).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it("writes to both terminal and file simultaneously", () => {
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: true,
      toFile: true,
      filePath: "both.log",
    });

    logger.logAuthentication("bob");

    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(mockedAppendFileSync).toHaveBeenCalledOnce();

    const terminalOutput = stderrSpy.mock.calls[0][0] as string;
    const [filePath, fileContent] = mockedAppendFileSync.mock.calls[0];

    expect(filePath).toBe("both.log");
    expect(terminalOutput).toContain("[CONN]");
    expect(terminalOutput).toContain("Authenticated");
    expect(fileContent).toContain("[CONN]");
    expect(fileContent).toContain("Authenticated");
  });
});


// ---------------------------------------------------------------------------
// Log Rotation Tests (Req 1.1–1.6)
// ---------------------------------------------------------------------------

describe("KonductorLogger — Log Rotation", () => {
  const mockedAppendFileSync = vi.mocked(appendFileSync);
  const mockedStatSync = vi.mocked(statSync);
  const mockedUnlinkSync = vi.mocked(unlinkSync);
  const mockedRenameSync = vi.mocked(renameSync);

  beforeEach(() => {
    mockedAppendFileSync.mockClear();
    mockedStatSync.mockClear();
    mockedUnlinkSync.mockClear();
    mockedRenameSync.mockClear();
  });

  it("does not rotate when file is under max size", () => {
    mockedStatSync.mockReturnValue({ size: 1000 } as any);
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
      filePath: "test.log",
      maxFileSize: 10 * 1024 * 1024,
    });

    logger.logServerStart("stdio");

    expect(mockedRenameSync).not.toHaveBeenCalled();
    expect(mockedUnlinkSync).not.toHaveBeenCalled();
    expect(mockedAppendFileSync).toHaveBeenCalledOnce();
  });

  it("rotates when file reaches max size", () => {
    mockedStatSync.mockReturnValue({ size: 11 * 1024 * 1024 } as any);
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
      filePath: "test.log",
      maxFileSize: 10 * 1024 * 1024,
    });

    logger.logServerStart("stdio");

    // Should attempt: unlinkSync(.tobedeleted), renameSync(.backup → .tobedeleted), renameSync(current → .backup)
    expect(mockedUnlinkSync).toHaveBeenCalledWith("test.log.tobedeleted");
    expect(mockedRenameSync).toHaveBeenCalledWith("test.log.backup", "test.log.tobedeleted");
    expect(mockedRenameSync).toHaveBeenCalledWith("test.log", "test.log.backup");
    expect(mockedAppendFileSync).toHaveBeenCalledOnce();
  });

  it("rotates at exact max size boundary", () => {
    const maxSize = 5 * 1024 * 1024;
    mockedStatSync.mockReturnValue({ size: maxSize } as any);
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
      filePath: "exact.log",
      maxFileSize: maxSize,
    });

    logger.logServerStart("stdio");

    expect(mockedRenameSync).toHaveBeenCalledWith("exact.log", "exact.log.backup");
  });

  it("handles missing file gracefully (no rotation needed)", () => {
    mockedStatSync.mockImplementation(() => { throw new Error("ENOENT"); });
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
      filePath: "missing.log",
      maxFileSize: 10 * 1024 * 1024,
    });

    // Should not throw
    logger.logServerStart("stdio");

    expect(mockedRenameSync).not.toHaveBeenCalled();
    expect(mockedAppendFileSync).toHaveBeenCalledOnce();
  });

  it("handles missing .tobedeleted and .backup gracefully during rotation", () => {
    mockedStatSync.mockReturnValue({ size: 20 * 1024 * 1024 } as any);
    mockedUnlinkSync.mockImplementation(() => { throw new Error("ENOENT"); });
    mockedRenameSync.mockImplementation((src: any) => {
      if (src.endsWith(".backup")) throw new Error("ENOENT");
    });

    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
      filePath: "fresh.log",
      maxFileSize: 10 * 1024 * 1024,
    });

    // Should not throw — gracefully handles missing intermediate files
    logger.logServerStart("stdio");

    expect(mockedAppendFileSync).toHaveBeenCalledOnce();
  });

  it("defaults to 10MB when maxFileSize is not provided", () => {
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
      filePath: "default.log",
    });

    // File is 9MB — should NOT rotate
    mockedStatSync.mockReturnValue({ size: 9 * 1024 * 1024 } as any);
    logger.logServerStart("stdio");
    expect(mockedRenameSync).not.toHaveBeenCalled();

    mockedAppendFileSync.mockClear();
    mockedRenameSync.mockClear();

    // File is 11MB — should rotate
    mockedStatSync.mockReturnValue({ size: 11 * 1024 * 1024 } as any);
    logger.logServerStart("stdio");
    expect(mockedRenameSync).toHaveBeenCalledWith("default.log", "default.log.backup");
  });
});

// ---------------------------------------------------------------------------
// parseFileSize Tests (Design Property 5)
// ---------------------------------------------------------------------------

describe("KonductorLogger — parseFileSize via constructor", () => {
  it("parses MB correctly", () => {
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
      filePath: "test.log",
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });

    const mockedStat = vi.mocked(statSync);
    mockedStat.mockReturnValue({ size: 10 * 1024 * 1024 } as any);

    logger.logServerStart("stdio");

    // At exactly 10MB, rotation should trigger
    expect(vi.mocked(renameSync)).toHaveBeenCalled();
  });

  it("custom small max size triggers rotation on small files", () => {
    const logger = new KonductorLogger({
      enabled: true,
      toTerminal: false,
      toFile: true,
      filePath: "small.log",
      maxFileSize: 1024, // 1KB
    });

    vi.mocked(statSync).mockReturnValue({ size: 2048 } as any);

    logger.logServerStart("stdio");

    expect(vi.mocked(renameSync)).toHaveBeenCalledWith("small.log", "small.log.backup");
  });
});
