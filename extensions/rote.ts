import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

export interface ActiveRoteContext {
  workspace: string;
  workspacePath: string;
  initializedSessions: string[];
}

export interface RoteRuntimeFacts {
  roteAvailable: boolean;
  roteVersion?: string;
  pendingStubCount?: number;
  pendingStubWorkspaces?: string[];
  activeContext?: ActiveRoteContext;
}

export interface ExploreHit {
  adapterId: string;
  tool: string;
  score?: number;
}

export interface CatalogHit {
  id: string;
  provider?: string;
  category?: string;
}

export interface RoteProbeResult {
  exploreHits: ExploreHit[];
  catalogHits: CatalogHit[];
}

export type BashCommandAnalysis =
  | { category: "allow_rote" | "allow_local_dev" | "allow_unknown" }
  | {
      category: "suggest_rote";
      service: string;
      exploreQuery: string;
      catalogQuery: string;
      reason: string;
    };

const ROTE_PATTERN = /(^|(?:&&|\|\||;|\|)\s*)rote\b/;
const LOCAL_DEV_PATTERNS = [
  /^\s*(cargo|npm|pnpm|yarn|deno|pytest|uv|python -m pytest|python3 -m pytest)\b/,
  /^\s*git\b/,
  /^\s*(ls|find|rg|fd)\b/,
  /^\s*(make|just)\b/,
];
const DEFAULT_WORKSPACE_ROOT = "~/.rote/rote/workspaces";
export function getBundledRoteSkillDir(extensionModuleUrl: string): string {
  return join(dirname(fileURLToPath(extensionModuleUrl)), "..", "skills", "rote");
}

export function getBundledRoteAdapterSkillDir(extensionModuleUrl: string): string {
  return join(dirname(fileURLToPath(extensionModuleUrl)), "..", "skills", "rote-adapter");
}

export function buildDiscoveredSkillPaths(input: {
  bundledRoteSkillDir: string;
  bundledRoteAdapterSkillDir: string;
}): string[] {
  return [input.bundledRoteSkillDir, input.bundledRoteAdapterSkillDir];
}

export function parsePendingStubFacts(stdout: string): Partial<RoteRuntimeFacts> {
  try {
    const parsed = JSON.parse(stdout) as {
      total?: number;
      pending?: Array<{ workspace?: string }>;
    };

    const workspaces = (parsed.pending ?? [])
      .map((item) => item.workspace)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    return {
      pendingStubCount: typeof parsed.total === "number" ? parsed.total : workspaces.length,
      pendingStubWorkspaces: workspaces,
    };
  } catch {
    return {};
  }
}

export function parseExploreHits(stdout: string): ExploreHit[] {
  try {
    const parsed = JSON.parse(stdout) as Array<{
      adapter_id?: string;
      tool?: string;
      score?: number;
    }>;

    return parsed
      .filter((item) => typeof item.adapter_id === "string" && typeof item.tool === "string")
      .map((item) => ({
        adapterId: item.adapter_id!,
        tool: item.tool!,
        score: item.score,
      }));
  } catch {
    return [];
  }
}

export function parseCatalogHits(stdout: string): CatalogHit[] {
  try {
    const parsed = JSON.parse(stdout) as Array<{
      id?: string;
      provider?: string;
      category?: string;
    }>;

    return parsed
      .filter((item) => typeof item.id === "string")
      .map((item) => ({
        id: item.id!,
        provider: item.provider,
        category: item.category,
      }));
  } catch {
    return [];
  }
}

function dedupeSessions(sessions: string[]): string[] {
  return [...new Set(sessions)];
}

function parseWorkspacePathFromCommand(command: string): { workspace: string; workspacePath: string } | undefined {
  const cdMatch = command.match(/\bcd\s+([^;&|]+)\s*(?:&&|\|\||;|\|)/);
  if (!cdMatch) {
    return undefined;
  }

  const workspacePath = cdMatch[1].trim().replace(/^['"]|['"]$/g, "");
  const workspaceMatch = workspacePath.match(/\/workspaces\/([^/\s'"`]+)$/);
  if (!workspaceMatch) {
    return undefined;
  }

  return {
    workspace: workspaceMatch[1],
    workspacePath,
  };
}

export function deriveActiveRoteContextFromCommand(
  command: string,
  current: ActiveRoteContext | undefined,
): ActiveRoteContext | undefined {
  let next = current;

  const workspaceFromCd = parseWorkspacePathFromCommand(command);
  if (workspaceFromCd) {
    next = {
      workspace: workspaceFromCd.workspace,
      workspacePath: workspaceFromCd.workspacePath,
      initializedSessions:
        current?.workspace === workspaceFromCd.workspace ? current.initializedSessions : [],
    };
  }

  const initMatch = command.match(/(?:^|(?:&&|\|\||;|\|)\s*)rote\s+init\s+([A-Za-z0-9._-]+)/);
  if (initMatch) {
    next = {
      workspace: initMatch[1],
      workspacePath: `${DEFAULT_WORKSPACE_ROOT}/${initMatch[1]}`,
      initializedSessions: [],
    };
  }

  const initSessionMatch = command.match(
    /(?:^|(?:&&|\|\||;|\|)\s*)rote\s+init-session\s+(adapter\/[A-Za-z0-9._-]+)/,
  );
  if (initSessionMatch && next) {
    next = {
      ...next,
      initializedSessions: dedupeSessions([
        ...next.initializedSessions,
        initSessionMatch[1],
      ]),
    };
  }

  return next;
}

export function analyzeBashCommand(command: string): BashCommandAnalysis {
  if (ROTE_PATTERN.test(command)) {
    return { category: "allow_rote" };
  }

  if (LOCAL_DEV_PATTERNS.some((pattern) => pattern.test(command))) {
    return { category: "allow_local_dev" };
  }

  if (
    /^\s*gh\s+issue\b/.test(command) ||
    /^\s*(?:curl|wget)\s+https?:\/\/api\.github\.com\/.*\/issues\b/.test(command)
  ) {
    return {
      category: "suggest_rote",
      service: "github",
      exploreQuery: "github issues",
      catalogQuery: "github",
      reason: "GitHub workflow command detected; rote may already have installed or catalogued support.",
    };
  }

  if (/^\s*gh\s+/.test(command)) {
    return {
      category: "suggest_rote",
      service: "github",
      exploreQuery: "github",
      catalogQuery: "github",
      reason: "GitHub workflow command detected; rote may already have installed or catalogued support.",
    };
  }

  if (/^\s*supabase\b/.test(command)) {
    return {
      category: "suggest_rote",
      service: "supabase",
      exploreQuery: "supabase",
      catalogQuery: "supabase",
      reason: "Supabase CLI command detected; rote may already have installed or catalogued support.",
    };
  }

  if (/^\s*stripe\b/.test(command)) {
    return {
      category: "suggest_rote",
      service: "stripe",
      exploreQuery: "stripe",
      catalogQuery: "stripe",
      reason: "Stripe CLI command detected; rote may already have installed or catalogued support.",
    };
  }

  if (/^\s*linear\b/.test(command)) {
    return {
      category: "suggest_rote",
      service: "linear",
      exploreQuery: "linear",
      catalogQuery: "linear",
      reason: "Linear CLI command detected; rote may already have installed or catalogued support.",
    };
  }

  return { category: "allow_unknown" };
}

export function buildPromptAppend(facts: RoteRuntimeFacts): string {
  const runtimeHints: string[] = [];

  if (facts.roteAvailable) {
    runtimeHints.push(
      facts.roteVersion
        ? `- rote CLI is available in this session (${facts.roteVersion}).`
        : "- rote CLI is available in this session.",
    );
  } else {
    runtimeHints.push(
      "- rote CLI is unavailable in this session; rote-first guidance is advisory only until `rote` is on PATH.",
    );
  }

  if (facts.activeContext) {
    runtimeHints.push(
      `- Active rote context in this chat: workspace ${facts.activeContext.workspace}; workspace path ${facts.activeContext.workspacePath}; initialized sessions ${facts.activeContext.initializedSessions.length > 0 ? facts.activeContext.initializedSessions.join(", ") : "(none yet)"}; reminder: workspace-bound rote commands do not inherit shell cwd across calls, so re-enter the workspace directory when needed.`,
    );
  }

  if ((facts.pendingStubCount ?? 0) > 0) {
    const workspaces = (facts.pendingStubWorkspaces ?? []).join(", ");
    runtimeHints.push(
      workspaces.length > 0
        ? `- pending flow stubs exist (${facts.pendingStubCount}): ${workspaces}. If the user refers to one of these workspaces, resume with \`rote flow pending save <workspace>\`.`
        : `- pending flow stubs exist (${facts.pendingStubCount}). If the user refers to one of these workspaces, resume with \`rote flow pending save <workspace>\`.`,
    );
  }

  return `## rote-first workflow policy

Use native pi file tools (read, edit, write) for local code and file work.
Use \`bash\` with raw \`rote ...\` commands for workflow, adapter, API, and automation tasks.
Prefer rote over direct \`curl\`, \`gh\`, or service CLIs when rote should own the workflow.

Follow the rote lifecycle: **search → execute → crystallize → reuse**.
- Search for an existing flow first with \`rote flow search "<capability>"\`.
- Search for the capability, not the raw parameters.
- If no flow exists, do the work in rote so it stays crystallizable.
- After successful reusable work, crystallize it into a draft flow instead of leaving it as one-off shell history.

When uncertain, consult rote itself instead of guessing:
- \`rote start\`
- \`rote how --compact\`
- \`rote grammar <topic>\`
- \`rote machine <topic>\`

Treat rote's own warnings, hints, pending-stub reminders, and scaffold instructions as authoritative.
Do not bypass rote's crystallization lifecycle when it is steering you toward \`pending write\` / \`pending save\`.

Runtime hints:
${runtimeHints.join("\n")}`;
}

export function buildRoteOpportunityHint(
  facts: RoteRuntimeFacts,
  analysis: BashCommandAnalysis,
  probe: RoteProbeResult,
): string | undefined {
  if (analysis.category !== "suggest_rote") {
    return undefined;
  }

  const lines: string[] = ["rote hint:", `- ${analysis.reason}`];

  if (facts.activeContext) {
    lines.push(
      `- active workspace: ${facts.activeContext.workspace} (${facts.activeContext.workspacePath})`,
    );
    lines.push(
      `- initialized sessions: ${facts.activeContext.initializedSessions.length > 0 ? facts.activeContext.initializedSessions.join(", ") : "(none yet)"}`,
    );
  }

  if (probe.exploreHits.length > 0) {
    const adapters = [...new Set(probe.exploreHits.map((hit) => hit.adapterId))];
    lines.push(`- installed rote support detected: ${adapters.join(", ")}`);
    const prefix = facts.activeContext ? `cd ${facts.activeContext.workspacePath} && ` : "";
    lines.push(`- try: ${prefix}rote flow search "${analysis.exploreQuery}"`);
    lines.push(`- try: ${prefix}rote explore "${analysis.exploreQuery}"`);
    return lines.join("\n");
  }

  if (probe.catalogHits.length > 0) {
    const candidate = probe.catalogHits[0];
    lines.push("- no installed rote adapter hit found");
    lines.push(`- adapter catalog candidate: ${candidate.id}`);
    lines.push(`- inspect: rote adapter catalog info ${candidate.id}`);
    lines.push(`- install: rote adapter new ${candidate.id} --yes`);
    return lines.join("\n");
  }

  return undefined;
}

async function probeRoteFacts(exec: ExtensionAPI["exec"]): Promise<RoteRuntimeFacts> {
  try {
    const versionResult = await exec("rote", ["--version"]);
    if (versionResult.code !== 0) {
      return { roteAvailable: false };
    }

    const versionMatch = versionResult.stdout.trim().match(/^rote\s+(.+)$/m);
    const facts: RoteRuntimeFacts = {
      roteAvailable: true,
      roteVersion: versionMatch?.[1],
    };

    const pendingResult = await exec("rote", ["flow", "pending", "list", "--json"]);
    if (pendingResult.code === 0) {
      Object.assign(facts, parsePendingStubFacts(pendingResult.stdout));
    }

    return facts;
  } catch {
    return { roteAvailable: false };
  }
}

async function probeRoteSupport(
  exec: ExtensionAPI["exec"],
  analysis: BashCommandAnalysis,
): Promise<RoteProbeResult> {
  if (analysis.category !== "suggest_rote") {
    return { exploreHits: [], catalogHits: [] };
  }

  let exploreHits: ExploreHit[] = [];
  let catalogHits: CatalogHit[] = [];

  try {
    const exploreResult = await exec("rote", ["explore", analysis.exploreQuery, "--json"]);
    if (exploreResult.code === 0) {
      exploreHits = parseExploreHits(exploreResult.stdout);
    }
  } catch {
    // best-effort probe only
  }

  try {
    const catalogResult = await exec("rote", [
      "adapter",
      "catalog",
      "search",
      analysis.catalogQuery,
      "--json",
    ]);
    if (catalogResult.code === 0) {
      catalogHits = parseCatalogHits(catalogResult.stdout);
    }
  } catch {
    // best-effort probe only
  }

  return { exploreHits, catalogHits };
}

export default function roteExtension(pi: ExtensionAPI) {
  let facts: RoteRuntimeFacts = { roteAvailable: false };
  const probeCache = new Map<string, RoteProbeResult>();

  const bundledRoteSkillDir = getBundledRoteSkillDir(import.meta.url);
  const bundledRoteAdapterSkillDir = getBundledRoteAdapterSkillDir(import.meta.url);

  pi.on("resources_discover", async () => {
    return {
      skillPaths: buildDiscoveredSkillPaths({
        bundledRoteSkillDir,
        bundledRoteAdapterSkillDir,
      }),
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    facts = await probeRoteFacts((command, args, options) => pi.exec(command, args, options));


    if (!ctx.hasUI) {
      return;
    }

    if (facts.roteAvailable) {
      ctx.ui.notify(
        facts.roteVersion ? `rote available (${facts.roteVersion})` : "rote available",
        "info",
      );

    } else {
      ctx.ui.notify(
        "rote CLI not found on PATH; rote-first workflow guidance will be advisory only.",
        "warning",
      );
    }
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildPromptAppend(facts)}`,
    };
  });

  pi.on("tool_result", async (event) => {
    if (!isBashToolResult(event)) {
      return;
    }

    const command = event.input.command as string;

    if (!event.isError) {
      const nextContext = deriveActiveRoteContextFromCommand(
        command,
        facts.activeContext,
      );

      if (nextContext) {
        facts = {
          ...facts,
          activeContext: nextContext,
        };
      }
    }

    if (!facts.roteAvailable) {
      return;
    }

    const analysis = analyzeBashCommand(command);
    if (analysis.category !== "suggest_rote") {
      return;
    }

    const cacheKey = `${analysis.service}:${analysis.exploreQuery}`;
    let probe = probeCache.get(cacheKey);
    if (!probe) {
      probe = await probeRoteSupport(
        (command, args, options) => pi.exec(command, args, options),
        analysis,
      );
      probeCache.set(cacheKey, probe);
    }

    const hint = buildRoteOpportunityHint(facts, analysis, probe);
    if (!hint) {
      return;
    }

    return {
      content: [...event.content, { type: "text", text: hint }],
    };
  });
}
