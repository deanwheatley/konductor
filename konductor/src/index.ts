#!/usr/bin/env node

/**
 * Konductor MCP Server — entry point.
 *
 * Exposes four MCP tools (register_session, check_status, deregister_session,
 * list_sessions) over stdio (default) or SSE transport.
 *
 * Usage:
 *   npx konductor              # stdio transport (local)
 *   npx konductor --sse        # SSE transport on KONDUCTOR_PORT (default 3100)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { resolve } from "node:path";

import { SessionManager } from "./session-manager.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { SummaryFormatter } from "./summary-formatter.js";
import { ConfigManager } from "./config-manager.js";
import { PersistenceStore } from "./persistence-store.js";
import type { CollisionResult } from "./types.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const REPO_REGEX = /^[^/]+\/[^/]+$/;

function validateRepo(repo: string): string | null {
  if (!REPO_REGEX.test(repo)) {
    return `Invalid repo format "${repo}": expected "owner/repo"`;
  }
  return null;
}

function validateFiles(files: string[]): string | null {
  if (files.length === 0) {
    return "File list must not be empty";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bootstrap components
// ---------------------------------------------------------------------------

export async function createComponents(configPath?: string, sessionsPath?: string) {
  const cfgPath = configPath ?? resolve(process.cwd(), "konductor.yaml");
  const sesPath = sessionsPath ?? resolve(process.cwd(), "sessions.json");

  const configManager = new ConfigManager();
  await configManager.load(cfgPath);

  const persistenceStore = new PersistenceStore(sesPath);
  const sessionManager = new SessionManager(
    persistenceStore,
    () => configManager.getTimeout() * 1000,
  );
  await sessionManager.init();

  const collisionEvaluator = new CollisionEvaluator();
  const summaryFormatter = new SummaryFormatter();

  // Watch for config changes
  configManager.onConfigChange(() => {
    /* config is already updated internally */
  });

  return { configManager, sessionManager, collisionEvaluator, summaryFormatter };
}


// ---------------------------------------------------------------------------
// Build MCP server with tool registrations
// ---------------------------------------------------------------------------

export function buildMcpServer(deps: {
  sessionManager: SessionManager;
  collisionEvaluator: CollisionEvaluator;
  summaryFormatter: SummaryFormatter;
  configManager: ConfigManager;
}): McpServer {
  const { sessionManager, collisionEvaluator, summaryFormatter, configManager } = deps;

  const mcp = new McpServer(
    { name: "konductor", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // ── register_session ────────────────────────────────────────────────
  mcp.tool(
    "register_session",
    "Register or update a work session for a user in a repository. Returns the current collision state.",
    {
      userId: z.string().min(1).describe("User identifier"),
      repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      branch: z.string().min(1).describe("Git branch name"),
      files: z.array(z.string().min(1)).describe("List of file paths being modified"),
    },
    async ({ userId, repo, branch, files }) => {
      const repoErr = validateRepo(repo);
      if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

      const filesErr = validateFiles(files);
      if (filesErr) return { content: [{ type: "text", text: JSON.stringify({ error: filesErr }) }], isError: true };

      const session = await sessionManager.register(userId, repo, branch, files);
      const allSessions = await sessionManager.getActiveSessions(repo);
      const result: CollisionResult = collisionEvaluator.evaluate(session, allSessions);
      result.actions = configManager.getStateActions(result.state);
      const summary = summaryFormatter.format(result);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            sessionId: session.sessionId,
            collisionState: result.state,
            summary,
          }),
        }],
      };
    },
  );

  // ── check_status ────────────────────────────────────────────────────
  mcp.tool(
    "check_status",
    "Check the current collision state for a user in a repository without modifying sessions.",
    {
      userId: z.string().min(1).describe("User identifier"),
      repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      files: z.array(z.string().min(1)).optional().describe("Optional file list override; uses existing session files if omitted"),
    },
    async ({ userId, repo, files }) => {
      const repoErr = validateRepo(repo);
      if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

      const allSessions = await sessionManager.getActiveSessions(repo);

      // Find the user's existing session (if any)
      const existingSession = allSessions.find((s) => s.userId === userId);

      if (!existingSession && (!files || files.length === 0)) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: `No active session found for user "${userId}" in repo "${repo}". Provide a files list or register a session first.` }),
          }],
          isError: true,
        };
      }

      // Build a virtual session for evaluation
      const querySession = existingSession
        ? { ...existingSession, files: files ?? existingSession.files }
        : {
            sessionId: "__check_status__",
            userId,
            repo,
            branch: "",
            files: files!,
            createdAt: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
          };

      const result: CollisionResult = collisionEvaluator.evaluate(querySession, allSessions);
      result.actions = configManager.getStateActions(result.state);
      const summary = summaryFormatter.format(result);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            collisionState: result.state,
            overlappingSessions: result.overlappingSessions.map((s) => ({
              sessionId: s.sessionId,
              userId: s.userId,
              branch: s.branch,
              files: s.files,
            })),
            summary,
            actions: result.actions,
          }),
        }],
      };
    },
  );

  // ── deregister_session ──────────────────────────────────────────────
  mcp.tool(
    "deregister_session",
    "Remove a work session by its session ID.",
    {
      sessionId: z.string().min(1).describe("The session ID to deregister"),
    },
    async ({ sessionId }) => {
      const removed = await sessionManager.deregister(sessionId);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: removed,
            message: removed
              ? `Session ${sessionId} deregistered.`
              : `Session ${sessionId} not found.`,
          }),
        }],
      };
    },
  );

  // ── list_sessions ───────────────────────────────────────────────────
  mcp.tool(
    "list_sessions",
    "List all active (non-stale) work sessions for a repository.",
    {
      repo: z.string().min(1).describe('Repository in "owner/repo" format'),
    },
    async ({ repo }) => {
      const repoErr = validateRepo(repo);
      if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

      const sessions = await sessionManager.getActiveSessions(repo);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            sessions: sessions.map((s) => ({
              sessionId: s.sessionId,
              userId: s.userId,
              repo: s.repo,
              branch: s.branch,
              files: s.files,
              createdAt: s.createdAt,
              lastHeartbeat: s.lastHeartbeat,
            })),
          }),
        }],
      };
    },
  );

  return mcp;
}


// ---------------------------------------------------------------------------
// SSE transport with API key auth
// ---------------------------------------------------------------------------

function startSseServer(mcp: McpServer, port: number, apiKey: string | undefined) {
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for SSE
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // API key authentication
    if (apiKey) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing API key" }));
        return;
      }
    }

    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (req.method === "GET" && url.pathname === "/sse") {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => {
        transports.delete(transport.sessionId);
      });
      await mcp.connect(transport);
      return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing sessionId" }));
        return;
      }

      // Read body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

      const transport = transports.get(sessionId)!;
      await transport.handlePostMessage(req, res, body);
      return;
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, () => {
    console.error(`Konductor SSE server listening on port ${port}`);
  });

  return httpServer;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const useSSE = args.includes("--sse") || !!process.env.KONDUCTOR_PORT;

  const components = await createComponents();
  const mcp = buildMcpServer(components);

  if (useSSE) {
    const port = parseInt(process.env.KONDUCTOR_PORT ?? "3100", 10);
    const apiKey = process.env.KONDUCTOR_API_KEY;
    startSseServer(mcp, port, apiKey);
  } else {
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
    console.error("Konductor MCP server running on stdio");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
