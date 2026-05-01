# pi-rote

`pi-rote` is a thin pi extension that makes **rote-first workflows** the default inside pi while keeping **rote itself** as the execution surface.

If a task looks like workflow, adapter, API, or automation work, `pi-rote` pushes the model toward:

**search → execute → crystallize → reuse**

If a task is normal local development, it stays out of the way.

## What this package is for

Use `pi-rote` when you want pi to:

- prefer `rote ...` over direct workflow/API commands when rote should own the task
- keep using native pi file tools for local code and file edits
- remember the current rote workspace/session context within the chat
- expose the `rote` and `rote-adapter` skills automatically
- nudge the model toward saving reusable rote flows instead of leaving one-off shell history

## What pi-rote does

`pi-rote` adds a thin guidance layer on top of pi. Concretely, it:

- appends a **rote-first policy block** to the agent prompt before the agent starts
- probes the local `rote` installation on session start to detect:
  - whether `rote` is available
  - the current `rote --version`
  - pending flow stubs
- bundles the main `rote` skill with the package
- bundles the standalone `rote-adapter` skill with the package
- exposes both bundled skills through extension-driven resource discovery
- tracks an **active rote context** for the current chat:
  - workspace name
  - workspace path
  - initialized adapter sessions
- watches bash tool results and, for a small set of likely bypass commands, appends a `rote hint:` block suggesting the relevant rote search/explore/install commands

## What pi-rote does **not** do

This package is intentionally small. It does **not**:

- replace the `rote` CLI
- execute workflows on its own
- implement adapters itself
- force the model to use rote in every case
- block direct commands such as `gh`, `curl`, or service CLIs
- rewrite shell commands before they run
- guarantee that every workflow/API task will be detected
- provide universal command interception across every CLI or API pattern
- do much beyond prompt guidance if `rote` is not installed on `PATH`

If you need hard enforcement, command blocking, or full orchestration outside of rote itself, this package does **not** provide that.

## Guidance vs enforcement

`pi-rote` is a **guidance layer**, not a hard policy engine.

In practice that means:

- it **does** inject prompt guidance
- it **does** append hints to some bash tool results
- it **does** remember some rote context inside the current chat
- it **does not** prevent the model from choosing a non-rote path
- it **does not** guarantee perfect workspace continuity
- it **does not** convert arbitrary shell commands into rote commands

The intended effect is:

1. make rote the default mental model for workflow/API work
2. preserve normal coding behavior for local development
3. reduce accidental bypass of rote when rote support already exists

## How it intervenes

There are three main intervention points.

### 1. Session-start probing

On session start, `pi-rote` checks whether `rote` is available and gathers a few runtime facts:

- `rote --version`
- pending flow stubs
The package ships the main `rote` skill and `rote-adapter` skill directly under `skills/`, so skill discovery does not depend on runtime generation.

### 2. Prompt augmentation

Before the agent starts, `pi-rote` appends a system-prompt block that:

- tells the model to use native pi file tools for local file work
- tells the model to use raw `rote ...` commands through `bash` for workflow/API tasks
- reminds the model about rote's lifecycle:
  - **search → execute → crystallize → reuse**
- includes runtime hints such as:
  - installed rote version
  - pending stubs
  - active workspace/session context when available

### 3. Tool-result hints for likely bypasses

After bash tool results, `pi-rote` inspects the command that ran.

It currently treats these categories differently:

- **allowed directly**
  - raw `rote ...`
  - common local dev commands like `git`, `cargo`, `npm`, `pytest`, `ls`, `find`, `rg`, `make`, `just`
- **candidate rote bypasses**
  - some `gh ...` commands
  - some `curl`/`wget` calls against GitHub API issue endpoints
  - selected service CLIs such as `supabase`, `stripe`, `linear`

For those candidate bypasses, the extension may append a `rote hint:` block suggesting:

- `rote flow search ...`
- `rote explore ...`
- `rote adapter catalog info ...`
- `rote adapter new ...`

This is heuristic, not exhaustive.

## Requirements

- `pi` installed
- `rote` installed and available on `PATH`

If `rote` is missing, the extension still exposes its bundled skills and adds guidance, but it will not be able to do rote probing.

## Install

```bash
pi install /absolute/path/to/pi-rote
```

Then start a fresh pi session. `pi-rote` exposes the bundled `rote` and `rote-adapter` skills directly from the package.

## Quick test without installing

```bash
cd /absolute/path/to/pi-rote
pi -e ./extensions/rote.ts
```

This direct extension mode should still expose both bundled skills:

- `rote`
- `rote-adapter`
- add the rote-first prompt guidance to the session

## Behavior contract

What you should expect from `pi-rote`:

- raw `rote ...` commands remain first-class
- normal coding commands remain usable
- likely workflow/API bypasses may receive a `rote hint:` block
- active rote workspace/session context may be carried forward within the current chat
- rote-first behavior becomes the default recommendation, not a hard requirement

What you should **not** assume:

- every direct API/CLI command will be recognized as a rote opportunity
- every follow-up request will perfectly recover workspace state
- the model will always obey the hint layer
- prompt guidance alone is equivalent to rote-native execution

## Example expectations

### Example: rote-worthy task

User asks:

```text
list my GitHub issues and save the workflow if it looks reusable
```

Expected behavior:

- the model starts with `rote flow search ...`
- if no flow exists, it moves into rote execution instead of jumping straight to `gh`
- after a successful reusable result, it treats crystallization as the next step

### Example: normal coding task

User asks:

```text
run cargo test and summarize failures
```

Expected behavior:

- the model uses normal `bash`
- the hint layer stays out of the way

### Example: likely bypass command

User asks:

```text
use gh issue list to inspect my GitHub issues
```

Expected behavior:

- the command is not blocked
- the tool result may include a `rote hint:` block
- the hint may mention installed rote support or an adapter catalog candidate
- the hint may suggest concrete next commands such as `rote flow search ...` or `rote explore ...`

## Current heuristic limits

The extension does not try to understand every possible workflow command.

A few important limits:

- command detection is pattern-based, not semantic across all CLIs
- bypass hinting is currently strongest for a small set of known services and command families
- active rote context is inferred from successful bash commands like `rote init`, `cd .../workspaces/...`, and `rote init-session ...`
- that context is **chat-local** and **best-effort**
- if the model never enters rote, there is no active rote context to carry forward

## Bundled skills

The package ships both skills directly:

- `skills/rote/SKILL.md` — copied from `../rote/crates/rote-cli/src/cli/skill/SKILL.md`
- `skills/rote-adapter/SKILL.md` — the adapter creation agent skill

Pi discovers both through the package manifest and the extension's `resources_discover` hook.

## Manual smoke checks

1. Start pi with the extension:

   ```bash
   pi -e ./extensions/rote.ts
   ```

2. Ask for a rote-worthy task:

   ```text
   list my GitHub issues and save the workflow if it looks reusable
   ```

   Expected behavior:

   - the model starts with `rote flow search ...`
   - if no flow exists, it moves into rote execution instead of calling `gh` directly
   - after a successful reusable result, it treats crystallization as the next step

3. Ask a follow-up that depends on the same workspace:

   ```text
   now inspect the previous rote result and continue in the same workspace
   ```

   Expected behavior:

   - the prompt has refreshed the active rote context hint when context was successfully inferred
   - the model re-enters the remembered workspace directory before running workspace-bound rote commands

4. Ask for a normal coding task:

   ```text
   run cargo test and summarize failures
   ```

   Expected behavior:

   - the model uses normal `bash`
   - the hint layer does not interfere

5. Ask for a likely bypass:

   ```text
   use gh issue list to inspect my GitHub issues
   ```

   Expected behavior:

   - the command still runs
   - the tool result may include a `rote hint:` block
   - the hint may mention installed rote support or an adapter catalog candidate and suggest concrete rote commands to try next

## Summary

`pi-rote` does one job:

- make **rote-first workflow behavior** the default inside pi
- without breaking normal local development behavior
- and without pretending to be a full enforcement layer

If you want a practical mental model, use this one:

- **pi-rote changes the model's default workflow posture**
- **rote still does the real workflow work**
- **local coding stays local**
- **direct bypasses are nudged, not blocked**
