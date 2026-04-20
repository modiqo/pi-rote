import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeBashCommand,
  buildDiscoveredSkillPaths,
  buildPromptAppend,
  buildRoteOpportunityHint,
  buildRoteSkillInstallArgs,
  deriveActiveRoteContextFromCommand,
  getBundledRoteAdapterSkillDir,
  getGeneratedCoreSkillDir,
  hasInstalledCoreRoteSkill,
  needsCoreRoteSkillBootstrap,
  parseExploreHits,
  parsePendingStubFacts,
  resolvePiAgentDir,
  type ActiveRoteContext,
  type BashCommandAnalysis,
  type RoteRuntimeFacts,
} from "../extensions/rote.ts";

test("buildPromptAppend includes the rote lifecycle and self-service docs", () => {
  const prompt = buildPromptAppend({ roteAvailable: true, roteVersion: "0.3.0" });

  assert.match(prompt, /search → execute → crystallize → reuse/i);
  assert.match(prompt, /rote flow search "<capability>"/i);
  assert.match(prompt, /rote start/i);
  assert.match(prompt, /rote how --compact/i);
  assert.match(prompt, /rote grammar <topic>/i);
  assert.match(prompt, /rote machine <topic>/i);
});

test("buildPromptAppend surfaces pending stub runtime hints when present", () => {
  const prompt = buildPromptAppend({
    roteAvailable: true,
    pendingStubCount: 2,
    pendingStubWorkspaces: ["github-issues", "calendar-summary"],
  });

  assert.match(prompt, /pending flow stubs exist/i);
  assert.match(prompt, /github-issues/);
  assert.match(prompt, /calendar-summary/);
  assert.match(prompt, /rote flow pending save <workspace>/i);
});

test("buildPromptAppend surfaces active rote context when present", () => {
  const prompt = buildPromptAppend({
    roteAvailable: true,
    activeContext: {
      workspace: "github-issues",
      workspacePath: "~/.rote/rote/workspaces/github-issues",
      initializedSessions: ["adapter/github"],
    },
  });

  assert.match(prompt, /Active rote context in this chat/i);
  assert.match(prompt, /github-issues/);
  assert.match(prompt, /~\/\.rote\/rote\/workspaces\/github-issues/);
  assert.match(prompt, /adapter\/github/);
  assert.match(prompt, /do not inherit shell cwd across calls/i);
});

test("parsePendingStubFacts returns count and workspace names from pending list JSON", () => {
  const facts = parsePendingStubFacts(
    JSON.stringify({
      total: 2,
      pending: [
        { workspace: "github-issues" },
        { workspace: "calendar-summary" }
      ]
    })
  );

  assert.deepEqual(facts, {
    pendingStubCount: 2,
    pendingStubWorkspaces: ["github-issues", "calendar-summary"],
  });
});

test("deriveActiveRoteContextFromCommand captures a workspace from rote init", () => {
  const next = deriveActiveRoteContextFromCommand("rote init github-issues --seq", undefined);

  assert.deepEqual(next, {
    workspace: "github-issues",
    workspacePath: "~/.rote/rote/workspaces/github-issues",
    initializedSessions: [],
  });
});

test("deriveActiveRoteContextFromCommand adds initialized sessions inside the active workspace", () => {
  const current: ActiveRoteContext = {
    workspace: "github-issues",
    workspacePath: "~/.rote/rote/workspaces/github-issues",
    initializedSessions: [],
  };

  const next = deriveActiveRoteContextFromCommand(
    "cd ~/.rote/rote/workspaces/github-issues && rote init-session adapter/github",
    current,
  );

  assert.deepEqual(next, {
    workspace: "github-issues",
    workspacePath: "~/.rote/rote/workspaces/github-issues",
    initializedSessions: ["adapter/github"],
  });
});

test("parseExploreHits extracts installed adapter hits from rote explore JSON", () => {
  const hits = parseExploreHits(
    JSON.stringify([
      { adapter_id: "github", tool: "issues/list", score: 98.1 },
      { adapter_id: "github", tool: "issues/get", score: 96.4 }
    ])
  );

  assert.deepEqual(hits, [
    { adapterId: "github", tool: "issues/list", score: 98.1 },
    { adapterId: "github", tool: "issues/get", score: 96.4 },
  ]);
});

test("analyzeBashCommand allows raw rote commands", () => {
  const analysis = analyzeBashCommand('cd /tmp && rote flow search "search repos"');

  assert.equal(analysis.category, "allow_rote");
});

test("analyzeBashCommand allows local development commands", () => {
  const analysis = analyzeBashCommand("cargo test --workspace --features test-helpers");

  assert.equal(analysis.category, "allow_local_dev");
});

test("analyzeBashCommand detects GitHub issue commands as rote opportunities", () => {
  const analysis = analyzeBashCommand("gh issue list --repo owner/repo");

  assert.deepEqual(analysis, {
    category: "suggest_rote",
    service: "github",
    exploreQuery: "github issues",
    catalogQuery: "github",
    reason: "GitHub workflow command detected; rote may already have installed or catalogued support.",
  } satisfies BashCommandAnalysis);
});

test("buildRoteOpportunityHint includes active context and suggested rote commands for installed support", () => {
  const hint = buildRoteOpportunityHint(
    {
      roteAvailable: true,
      activeContext: {
        workspace: "github-issues",
        workspacePath: "~/.rote/rote/workspaces/github-issues",
        initializedSessions: ["adapter/github"],
      },
    },
    {
      category: "suggest_rote",
      service: "github",
      exploreQuery: "github issues",
      catalogQuery: "github",
      reason: "GitHub workflow command detected; rote may already have installed or catalogued support.",
    },
    {
      exploreHits: [{ adapterId: "github", tool: "issues/list", score: 98.1 }],
      catalogHits: [{ id: "github", provider: "GitHub", category: "DevTools" }],
    },
  );

  assert.ok(hint);
  assert.match(hint!, /rote hint:/i);
  assert.match(hint!, /workspace: github-issues/i);
  assert.match(hint!, /adapter\/github/);
  assert.match(hint!, /rote flow search "github issues"/i);
  assert.match(hint!, /rote explore "github issues"/i);
});

test("buildRoteOpportunityHint falls back to adapter catalog guidance when no installed support exists", () => {
  const hint = buildRoteOpportunityHint(
    { roteAvailable: true },
    {
      category: "suggest_rote",
      service: "supabase",
      exploreQuery: "supabase",
      catalogQuery: "supabase",
      reason: "Supabase CLI command detected; rote may already have installed or catalogued support.",
    },
    {
      exploreHits: [],
      catalogHits: [{ id: "supabase", provider: "Supabase", category: "Data / Backend" }],
    },
  );

  assert.ok(hint);
  assert.match(hint!, /adapter catalog candidate: supabase/i);
  assert.match(hint!, /rote adapter catalog info supabase/i);
  assert.match(hint!, /rote adapter new supabase --yes/i);
});

test("resolvePiAgentDir prefers PI_CODING_AGENT_DIR when set", () => {
  assert.equal(
    resolvePiAgentDir({ PI_CODING_AGENT_DIR: "/tmp/pi-agent" }, "/Users/rob"),
    "/tmp/pi-agent",
  );
});

test("resolvePiAgentDir falls back to ~/.pi/agent when env override is missing", () => {
  assert.equal(
    resolvePiAgentDir({}, "/Users/rob"),
    "/Users/rob/.pi/agent",
  );
});

test("getGeneratedCoreSkillDir uses the pi-managed cache location", () => {
  assert.equal(
    getGeneratedCoreSkillDir("/Users/rob/.pi/agent"),
    "/Users/rob/.pi/agent/cache/pi-rote/skills/rote",
  );
});

test("getBundledRoteAdapterSkillDir resolves ../skills/rote-adapter from the extension module url", () => {
  assert.equal(
    getBundledRoteAdapterSkillDir("file:///tmp/pi-rote/extensions/rote.ts"),
    "/tmp/pi-rote/skills/rote-adapter",
  );
});

test("buildRoteSkillInstallArgs uses the cursor provider and custom path", () => {
  assert.deepEqual(buildRoteSkillInstallArgs("/tmp/pi-agent/cache/pi-rote/skills/rote"), [
    "install",
    "skill",
    "--provider",
    "cursor",
    "--path",
    "/tmp/pi-agent/cache/pi-rote/skills/rote",
  ]);
});

test("hasInstalledCoreRoteSkill checks for SKILL.md inside the generated directory", () => {
  assert.equal(
    hasInstalledCoreRoteSkill(
      "/tmp/pi-agent/cache/pi-rote/skills/rote",
      (path) => path === "/tmp/pi-agent/cache/pi-rote/skills/rote/SKILL.md",
    ),
    true,
  );

  assert.equal(
    hasInstalledCoreRoteSkill(
      "/tmp/pi-agent/cache/pi-rote/skills/rote",
      () => false,
    ),
    false,
  );
});

test("needsCoreRoteSkillBootstrap returns true when the generated skill is missing", () => {
  assert.equal(
    needsCoreRoteSkillBootstrap({
      coreSkillInstalled: false,
      roteVersion: "0.4.0",
      cachedRoteVersion: undefined,
    }),
    true,
  );
});

test("needsCoreRoteSkillBootstrap returns true when the cached skill version differs", () => {
  assert.equal(
    needsCoreRoteSkillBootstrap({
      coreSkillInstalled: true,
      roteVersion: "0.4.0",
      cachedRoteVersion: "0.3.9",
    }),
    true,
  );
});

test("needsCoreRoteSkillBootstrap returns false when the generated skill exists and version matches", () => {
  assert.equal(
    needsCoreRoteSkillBootstrap({
      coreSkillInstalled: true,
      roteVersion: "0.4.0",
      cachedRoteVersion: "0.4.0",
    }),
    false,
  );
});

test("buildDiscoveredSkillPaths always includes bundled skill and conditionally includes generated core skill", () => {
  assert.deepEqual(
    buildDiscoveredSkillPaths({
      bundledSkillDir: "/tmp/pi-rote/skills/rote-adapter",
      generatedCoreSkillDir: "/tmp/pi-agent/cache/pi-rote/skills/rote",
      generatedCoreSkillReady: true,
    }),
    [
      "/tmp/pi-rote/skills/rote-adapter",
      "/tmp/pi-agent/cache/pi-rote/skills/rote",
    ],
  );

  assert.deepEqual(
    buildDiscoveredSkillPaths({
      bundledSkillDir: "/tmp/pi-rote/skills/rote-adapter",
      generatedCoreSkillDir: "/tmp/pi-agent/cache/pi-rote/skills/rote",
      generatedCoreSkillReady: false,
    }),
    ["/tmp/pi-rote/skills/rote-adapter"],
  );
});
