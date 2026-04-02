# drupal-sdc-lsp — Specification, Architecture & Task Backlog

> **Status:** Active development &middot; **Phase:** 1 (Foundation)  
> **Stack:** TypeScript (strict) &middot; pnpm workspaces &middot; vscode-languageserver &middot; vitest  
> **Editors:** Neovim &ge;0.11 &middot; VS Code &ge;1.85

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Existing Tools &mdash; Use, Reference, Skip](#2-existing-tools--use-reference-skip)
3. [Architecture](#3-architecture)
4. [Feature Phases](#4-feature-phases)
5. [Robustness &amp; DX Principles](#5-robustness--dx-principles)
6. [Task List](#6-task-list)
7. [Neovim Quick-Start](#7-neovim-quick-start)
8. [Open Questions &amp; Future Ideas](#8-open-questions--future-ideas)

---

## 1. Project Overview

### What is `drupal-sdc-lsp`?

`drupal-sdc-lsp` is a TypeScript Language Server Protocol (LSP) server purpose-built for developers writing Twig templates in Drupal projects that use **Single Directory Components (SDC)** &mdash; the component system that shipped in Drupal core 10.1. It provides the editor tooling that the existing Twig and YAML language servers cannot: autocomplete for Drupal-specific component IDs, IntelliSense for component props and slots, go-to-definition navigation to component source files, and inline hover documentation.

The server is a **stdio LSP process**, making it editor-agnostic by design. It has first-class support for Neovim (consumed directly via `vim.lsp.config` or `nvim-lspconfig`) and VS Code (wrapped in a thin extension using `vscode-languageclient`). It requires no Drupal runtime, no PHP, and no database connection &mdash; it works purely from static file analysis.

### The Problem

When writing Twig templates in a Drupal SDC project, developers face a tooling gap that makes even basic component usage friction-heavy:

- `{% include 'example:wysiwyg' %}` is a valid Drupal SDC include, but every general-purpose Twig LSP reports it as a "template not found" error because it does not understand the `provider:component` ID format.
- There is no autocomplete for SDC component IDs (`example:wysiwyg`, `example:card`) or for Twig namespace paths (`@example/atoms/button/button.twig`).
- There is no IntelliSense for props and slots declared in `.component.yml` files &mdash; developers must open the YAML file manually to see what a component accepts.
- There are no hover docs. Hovering over a component reference shows nothing.

General-purpose Twig LSPs do not understand Drupal&rsquo;s SDC conventions, and the only existing SDC-aware tool (`wunderio/drupal-sdc-helper`) is VS Code-only, unmaintained, and does not support Neovim users.

### What `drupal-sdc-lsp` is NOT

- **Not a replacement for `yaml-language-server`.** YAML validation of `.component.yml` files against Drupal&rsquo;s official JSON Schema is delegated entirely to `yaml-language-server`, which already handles this well. `drupal-sdc-lsp` reads those files to build its index but does not re-implement YAML schema validation.
- **Not a general Twig language server.** Syntax highlighting, Twig formatting, non-SDC template resolution, and standard Twig function signatures are out of scope. `twiggy-language-server` handles those concerns and must run alongside `drupal-sdc-lsp`. The two servers are complementary, not competing.
- **Not a Drupal runtime.** There is no PHP execution, no Twig template rendering, no database access. All features are derived from static file analysis alone.
- **Not tightly coupled to a single project.** The server accepts any workspace root and discovers components dynamically. It works for any Drupal SDC project.

### Approach: Static Indexing + LSP Protocol + Incremental Updates

On startup, the server walks the workspace filesystem for the active workspace root, locates all `.component.yml` files under any `components/` directory, parses their YAML metadata (component ID, name, description, props, slots, twig file path), and builds an in-memory registry. All completion, definition, and hover responses are served from this registry using the standard LSP protocol &mdash; responses are effectively `O(1)` hash-map lookups once the index is built. A file watcher keeps the index current as files are added, modified, or deleted during a working session.

### DX Philosophy

The server is built around four DX commitments:

1. **Fast startup.** Cold indexing for a workspace with up to 500 components must complete in under 2 seconds. The LSP `initialize` response must not be blocked by indexing &mdash; the server becomes ready immediately and indexing completes in the background.
2. **Zero-config defaults.** The server must work out of the box for any single-root Drupal SDC project with no configuration. Provider names, component paths, and namespaces are auto-detected from the filesystem.
3. **Graceful degradation.** If the workspace root cannot be determined, if a YAML file is malformed, or if a component is missing its `.twig` pair, the server continues running with a partial index. It never crashes. It never surfaces internal errors as editor noise.
4. **Never block, never crash the editor.** All I/O is async. All request handlers are wrapped in try/catch. Index-backed handlers wait on the initial readiness gate instead of racing an incomplete registry, and unrecoverable process-level failures are logged clearly before the process is allowed to terminate and restart cleanly under the editor/client supervisor.

---

## 2. Existing Tools &mdash; Use, Reference, Skip

| Tool | Role | How we use it |
|---|---|---|
| `moetelo/twiggy` (`twiggy-language-server`) | Strongest architectural reference and general-purpose Twig LSP &mdash; TypeScript, stdio, works in Neovim and VS Code | **Run alongside** `drupal-sdc-lsp` for general Twig features. **Primary implementation reference** for hot-path architecture: cached parsed documents/CST, cached local symbol state, small completion sub-providers, `DocumentCache` / `Document` split, namespace mapping objects, null-safe resolution helpers, and parser-backed test helpers. Prefer its parse-on-change, query-many-times model over request-time reparsing. |
| `redhat-developer/yaml-language-server` | YAML validation and JSON Schema enforcement | **Run alongside** `drupal-sdc-lsp`. Wire `*.component.yml` to the Drupal SDC JSON Schema URL. `drupal-sdc-lsp` reads the same files for indexing but delegates all schema validation here. |
| `kaermorchen/twig-language-server` | Smaller TypeScript Twig LSP with simple completion/definition/path-resolution flows | **Reference only.** Useful as a baseline for completion, definition, path resolution, and minimal LSP wiring. Also useful as a counterexample: it reparses on each request, so do not copy that pattern into hot paths. Do not depend on or fork. |
| `wunderio/drupal-sdc-helper` | VS Code-only extension for SDC component autocomplete | **Reference only.** Proves SDC indexing + `namespace:component` completion is achievable in ~500 lines. Study its component discovery logic and YAML parsing approach. VS Code-only, unmaintained &mdash; do not use directly. |
| `microsoft/vscode-extension-samples/lsp-sample` | Canonical VS Code extension + LSP client scaffold | **Use as scaffold** for `packages/vscode-client` in Phase 4. Provides the correct `LanguageClient` wiring between VS Code and a stdio LSP process. |
| `kaermorchen/tree-sitter-twig` / `gbprod/tree-sitter-twig` | Twig tree-sitter grammars | **Optional, Phase 3+.** Use only as a parsing upgrade for harder cursor-position problems. Keep it out of the MVP until regex/document-cache limits are real. |
| `moetelo/twiggy` (source) | Concrete source reference for internal package layout and provider composition | **Reference only.** Use it to mirror proven seams: split pure logic from server wiring, keep parsed-document state reusable across providers, and keep `onCompletion` as a thin orchestrator over smaller provider functions. |

---

## 3. Architecture

### Monorepo Structure

```
numiko-lsp/
&boxur;&boxh;&boxh; package.json                    # pnpm workspace root
&boxur;&boxh;&boxh; pnpm-workspace.yaml             # workspace packages glob
&boxur;&boxh;&boxh; tsconfig.base.json              # Shared TS config (strict, NodeNext, ES2022)
&boxur;&boxh;&boxh; vitest.config.ts                # Root vitest config (workspace mode)
&boxur;&boxh;&boxh; .editorconfig
&boxur;&boxh;&boxh; .gitignore
&boxur;&boxh;&boxh; MVP.md                          # This file
&boxur;&boxh;&boxh; README.md
&boxur;&boxh;&boxh;
&boxur;&boxh;&boxh; packages/
&boxur;&boxh;   &boxur;&boxh;&boxh; core/                       # Pure logic &mdash; no LSP or editor deps
&boxur;&boxh;   &boxur;   &boxur;&boxh;&boxh; package.json
&boxur;&boxh;   &boxur;   &boxur;&boxh;&boxh; tsconfig.json
&boxur;&boxh;   &boxur;   &boxur;&boxh;&boxh; src/
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; scanner.ts          # Walk workspace, find .component.yml paths
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; parser.ts           # Parse YAML &rarr; ComponentMetadata
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; registry.ts         # In-memory index, atomic swap on rebuild
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; twig-scanner.ts     # Walk workspace, find .twig + namespace map
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; context-detector.ts # Cursor-position analysis for with{} blocks
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; types.ts            # All shared TypeScript types/interfaces
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; index.ts            # Public API surface
&boxur;&boxh;   &boxur;   &boxur;&boxh;&boxh; src/__tests__/
&boxur;&boxh;   &boxur;       &boxur;&boxh;&boxh; scanner.test.ts
&boxur;&boxh;   &boxur;       &boxur;&boxh;&boxh; parser.test.ts
&boxur;&boxh;   &boxur;       &boxur;&boxh;&boxh; registry.test.ts
&boxur;&boxh;   &boxur;       &boxur;&boxh;&boxh; context-detector.test.ts
&boxur;&boxh;   &boxur;
&boxur;&boxh;   &boxur;&boxh;&boxh; language-server/            # Stdio LSP process &mdash; no VS Code deps
&boxur;&boxh;   &boxur;   &boxur;&boxh;&boxh; package.json
&boxur;&boxh;   &boxur;   &boxur;&boxh;&boxh; tsconfig.json
&boxur;&boxh;   &boxur;   &boxur;&boxh;&boxh; src/
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; server.ts           # LSP bootstrap, capability registration
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; completion.ts       # Completion provider (IDs, paths, props)
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; definition.ts       # Go-to-definition provider
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; hover.ts            # Hover provider (Phase 2)
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; diagnostics.ts      # Diagnostic publisher (Phase 3)
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; watcher.ts          # File system watcher, triggers re-index
&boxur;&boxh;   &boxur;   &boxur;   &boxur;&boxh;&boxh; logger.ts           # Structured stderr logging wrapper
&boxur;&boxh;   &boxur;   &boxur;&boxh;&boxh; src/__tests__/
&boxur;&boxh;   &boxur;       &boxur;&boxh;&boxh; integration.test.ts
&boxur;&boxh;   &boxur;
&boxur;&boxh;   &boxur;&boxh;&boxh; vscode-client/              # Thin VS Code extension (Phase 4)
&boxur;&boxh;       &boxur;&boxh;&boxh; package.json
&boxur;&boxh;       &boxur;&boxh;&boxh; tsconfig.json
&boxur;&boxh;       &boxur;&boxh;&boxh; src/
&boxur;&boxh;           &boxur;&boxh;&boxh; extension.ts        # LanguageClient setup, extension lifecycle
&boxur;&boxh;
&boxur;&boxh;&boxh; fixtures/
&boxur;&boxh;   &boxur;&boxh;&boxh; README.md
&boxur;&boxh;   &boxur;&boxh;&boxh; example/
&boxur;&boxh;       &boxur;&boxh;&boxh; atoms/
&boxur;&boxh;       &boxur;&boxh;&boxh; molecules/
&boxur;&boxh;       &boxur;&boxh;&boxh; organisms/
&boxur;&boxh;       &boxur;&boxh;&boxh; shared/
&boxur;&boxh;       &boxur;&boxh;&boxh; malformed/              # Intentionally broken YAML for negative tests
&boxur;&boxh;
&boxur;&boxh;&boxh; docs/
    &boxur;&boxh;&boxh; neovim-setup.md
    &boxur;&boxh;&boxh; vscode-setup.md
    &boxur;&boxh;&boxh; architecture.md
```

### Package Responsibilities

**`packages/core`**  
The brains of the project. Contains zero LSP or editor dependencies, making it independently unit-testable and reusable by other tools. Responsible for: recursively scanning a workspace root for `.component.yml` files; parsing those YAML files into a typed `ComponentMetadata` shape (ID, name, props, slots, twig path); maintaining an `SDCRegistry` that supports fast lookup by component ID, namespace path, provider, and partial name; and performing atomic index rebuilds where the old index remains fully readable until the new one is ready to swap in.

**`packages/language-server`**  
The stdio LSP process. Depends on `packages/core`, `vscode-languageserver/node`, and `vscode-languageserver-textdocument`. Owns: bootstrapping the LSP connection on stdin/stdout; creating `TextDocuments(TextDocument)` as the single in-memory document store; registering LSP capabilities; delegating feature logic to focused provider modules (completion, definition, hover, diagnostics); dynamically registering config/file-watch/workspace-folder hooks in `onInitialized`; owning any fallback watcher that triggers incremental re-indexing; and ensuring all I/O errors are caught, logged, and never propagated as unhandled rejections. This is the binary that Neovim (and the VS Code extension) spawns as a child process.

**`packages/vscode-client`** *(Phase 4)*  
A minimal VS Code extension containing zero language logic. Responsible only for spawning `packages/language-server` as a child process, connecting to it via `vscode-languageclient`, reading VS Code workspace settings, and passing them as `initializationOptions`. All intelligence lives in `language-server`; this package is a launcher.

### Data Flow: From File Change to Completion Response

```
Editor sends didOpen/didChange/didClose
    &darr;
  [TextDocuments(TextDocument)] update in-memory document store
    &darr;
Workspace file event (.component.yml saved)
    &darr;
  [watcher.ts] debounce(300ms), discard stale queued work, emit change event
    &darr;
  [registry.ts] parseComponentYaml(changedPath) &rarr; ComponentMetadata
    &darr;
  [registry.ts] atomic swap: newIndex built in background, replace currentIndex reference
    &darr;
  Editor types "{% include '" &rarr; triggers textDocument/completion
    &darr;
  [completion.ts] get latest document from TextDocuments, detect context
    &darr;
  [registry.ts] getAllComponents() &rarr; ComponentMetadata[]
    &darr;
  Map to CompletionItem[] &rarr; LSP response &rarr; editor renders dropdown
```

Cold startup path:

```
server.ts: createConnection(ProposedFeatures.all) before any stdout output
    &darr;
  TextDocuments(TextDocument) created and attached to connection
    &darr;
  onInitialize called
    &darr;
  Read params.workspaceFolders / rootUri (never rootPath)
    &darr;
  Respond immediately with capabilities only (do NOT await indexing) &rarr; initialize response sent
    &darr;
  onInitialized: register watched files / config hooks / workspace folder hooks, then buildRegistry(workspaceRoot) asynchronously
    &darr;
  [scanner.ts] walks filesystem &rarr; yields .component.yml paths
    &darr;
  [parser.ts] parses each YAML &rarr; ComponentMetadata (errors logged, not thrown)
    &darr;
  [registry.ts] index populated &rarr; readyPromise resolves
    &darr;
  Request handler gets latest document from TextDocuments, awaits readyPromise for index-backed features, checks cancellation/staleness, serves from index
```

### Runtime Architecture Notes

- `TextDocuments(TextDocument)` is the authoritative source for open-document text. Completion, hover, and diagnostics always read the latest document from this store rather than re-reading files from disk.
- `documents.get(uri)` may return `undefined` when a document was closed between scheduling and execution. Treat this as a normal race and return an empty/null result.
- MVP scope is single-root workspaces first. Keep the workspace model behind a workspace-index abstraction so multi-root support can be added later without rewriting providers.
- `onInitialize` declares capabilities only. Dynamic work such as file watching, config subscriptions, and workspace-folder registrations belongs in `onInitialized`.

### Document-state pattern to adopt

- Follow Twiggy&rsquo;s model, not a reparse-on-every-request model: `TextDocuments` holds the latest text, and the server may keep a lightweight parsed-document cache beside it for hot paths.
- Parse on `didOpen`/`didChange`, update cached CST/local symbol state once, then let completion/definition/hover query that cached state many times.
- Cache invalidation should be explicit and boring: a document version change replaces the cached parsed state for that URI; a close drops it; workspace-index rebuilds do not mutate open-document text state.
- If parsing fails for the current document, keep the failure local to that document and return safe empty/null feature results rather than throwing.

### Internal patterns worth standardising

- **Completion sub-providers** &mdash; Keep `onCompletion` as a dispatcher over small pure functions that each return `CompletionItem[]` for one concern (SDC IDs, Twig namespace paths, props/slots). This follows Twiggy&rsquo;s strongest pattern and keeps hot paths easy to test.
- **Namespace mapping type** &mdash; Represent namespace roots explicitly as objects such as `{ namespace, directory }` rather than parallel arrays or ad-hoc tuples. This keeps resolution logic readable and makes configuration safer.
- **Resolution rules** &mdash; Treat SDC ID resolution as strict and deterministic. Treat Twig namespace-path resolution as a small ordered fallback flow only, with a documented limit. Do not let path fallback become fuzzy guesswork.
- **Workspace index abstraction** &mdash; Keep multi-root support behind a dedicated workspace-index layer so providers ask one dependency for lookups instead of reimplementing workspace-folder selection logic.

### Decision log

- Adopt Twiggy&rsquo;s parse-on-change, query-many-times document-state pattern; reject kaermorchen&rsquo;s reparse-on-every-request hot-path model; defer `component()` support until after the MVP.

---

## 4. Feature Phases

### Phase 1 &mdash; Foundation: SDC Indexing, Component ID Completion, Go-to-Definition

**Goal:** A working stdio LSP that a Neovim developer can connect to today and immediately get `example:component-name` autocompletion and go-to-definition in their Twig templates for a single workspace root.

**Deliverables:**
- Monorepo scaffold with build tooling and TypeScript project references
- Workspace scanner that finds all `.component.yml` files recursively
- YAML parser that produces typed `ComponentMetadata` objects
- In-memory `SDCRegistry` with fast lookup by ID and namespace path
- `language-server` bootstrap with LSP `initialize`/`initialized` handshake
- Completion provider: trigger on `include`/`embed`/`extends` string literals, return SDC component IDs
- Go-to-definition: cursor on component ID &rarr; navigate to `.twig` file
- File watcher: debounced incremental re-index on `.component.yml` changes
- Neovim setup guide in `docs/neovim-setup.md`
- Fixture files from `pas-drupal` in `fixtures/example/`
- Unit tests for all `packages/core` modules
- Integration test for full LSP completion request/response cycle

**Definition of Done:**
- All unit and integration tests pass with zero failures
- `drupal-sdc-lsp` attaches cleanly in Neovim without errors in `:LspLog`
- Completing `{% include '` in a real Twig file shows at least one SDC completion item within 100ms
- Go-to-definition on a component ID opens the correct `.twig` file
- Server does not crash or exit during a 30-minute Neovim editing session
- Cold startup (indexing) completes in under 2 seconds on the `pas-drupal` workspace

---

### Phase 2 &mdash; Twig Path Completion &amp; Hover Documentation

**Goal:** Complete `@namespace/path/to/file.twig` strings in include/extends/embed calls, and show rich hover documentation when hovering over any component reference.

**Deliverables:**
- Twig template path scanner (all `.twig` files &rarr; namespace path map)
- Completion for `@namespace/...` strings (from Twig file index, not SDC registry)
- Hover provider: component name, description, props table, slots list in Markdown

**Definition of Done:**
- Typing `@example/` in a Twig string produces completions for all matching Twig files
- Hovering over `example:card` shows the component&rsquo;s name, description, props table, and slots list
- Hover over a component with no props/slots shows a graceful fallback message
- All Phase 1 tests continue to pass
- No new crashes or unhandled errors during a Neovim session

---

### Phase 3 &mdash; Prop/Slot Completion &amp; Diagnostics

**Goal:** Autocomplete prop keys inside `with { }` argument blocks, and warn developers when they reference an unknown component ID.

**Deliverables:**
- Twig invocation context detector: identifies cursor is inside a `with {}` block for a known component
- Completion for prop/slot keys inside `with {}` blocks (filtered, sorted by required)
- Diagnostic provider: warning on `provider:component` ID strings not found in the registry

**Definition of Done:**
- Typing `{% include 'example:card' with { ` produces prop key completions from `card.component.yml`
- Required props appear before optional ones in the completion list
- Already-typed keys are excluded from suggestions
- An unknown component ID like `example:nonexistent` gets a warning diagnostic with a clear message
- No false-positive diagnostics are emitted during startup because diagnostic passes wait for the initial readiness gate before resolving IDs
- All Phase 1 and 2 tests continue to pass

---

### Phase 4 &mdash; VS Code Extension

**Goal:** Package the language server as a VS Code extension with settings UI and publish it to the Marketplace.

**Deliverables:**
- `packages/vscode-client` extension that spawns the language server
- Extension settings: `componentPaths`, `providerName`, `disableUnknownComponentDiagnostic`, `logLevel`
- Extension packaging and CI publish pipeline
- VS Code Marketplace listing

**Definition of Done:**
- Extension installs cleanly from `.vsix` with `code --install-extension`
- All Phase 1&ndash;3 features work in VS Code after installation
- Extension shows a clear error notification if the server fails to start (not a silent failure)
- Extension auto-restarts the server on crash (max 3 attempts)
- `vsce package` completes without warnings in CI
- Extension is visible and installable from the VS Code Marketplace

---

## 5. Robustness &amp; DX Principles

This section defines non-negotiable behaviour for the server. Every task in Section 6 inherits these rules.

### Error Handling Rules

**File I/O**
- Every `fs.promises.*` call must be wrapped in try/catch or `.catch()`. Errors are logged to stderr and the operation returns a safe fallback value (empty array, null). The server never throws to its caller due to a filesystem error.
- Permission-denied errors (`EACCES`) on a directory: skip that directory, log a `warn`-level message, continue scanning siblings.
- The scanner must detect and break circular symlinks. Track visited inode IDs and skip revisited inodes.

**YAML Parsing**
- A malformed `.component.yml` (unparseable YAML, wrong type for a field) must result in: log a `warn`-level message with the file path and error message, return `null` from the parser, skip that component. Never throw.
- Missing `name` field: skip the component (cannot build a valid ID), log `warn`.
- Missing `props` key: treat as `[]`, not an error.
- Missing `slots` key: treat as `[]`, not an error.
- Missing paired `.twig` file: set `twigFilePath: null`, log `debug`. Component is still indexed.
- YAML parsing errors must never be surfaced as LSP diagnostics on the `.component.yml` file. That is `yaml-language-server`&rsquo;s job.

**LSP Request Handlers**
- Every handler registered with `connection.on*` must be wrapped in a top-level try/catch. Caught errors are logged with `connection.console.error`. The handler returns an empty/null response.
- The server process must never `process.exit()` due to an unhandled LSP request error.
- If the workspace root cannot be determined from `initialize` params: log a `warn`, run with an empty registry, show a single `window/showMessage` warning to the user.

**Diagnostics**
- Component ID resolution failures must never produce false-positive diagnostics. Diagnostic passes must await the initial readiness gate before resolving IDs, and may publish an empty list only when there are truly no matches, the workspace is empty, or the pass becomes stale/cancelled.
- Diagnostics must only fire on literal string matches of the `provider:component` pattern. Dynamic expressions, template variables, and computed strings must never trigger a diagnostic.
- A config option (`drupal-sdc-lsp.disableUnknownComponentDiagnostic`) must allow full opt-out of the diagnostic.
- Built-in Drupal core component providers (e.g. `drupal:*`) must be whitelisted and never produce warnings.

### Performance Requirements

| Operation | Target |
|---|---|
| Cold startup indexing (up to 500 components) | &lt; 2 seconds |
| Completion response (index already built) | &lt; 100ms |
| File watcher event &rarr; updated completions | &lt; 500ms |
| First completion after startup | Never empty due to race condition &mdash; index must be awaitable |

**Race condition prevention:** The registry exposes a `readyPromise: Promise<void>` that resolves when the initial index build completes. All completion, definition, hover, and diagnostic handlers must `await registry.readyPromise` before querying the index. Because the promise is already resolved for all subsequent requests after startup, the `await` is effectively free. Empty results are acceptable only when there are genuinely no matches, the workspace is empty, or the request is cancelled/stale.

### Logging Requirements

- All log output must go to **stderr**, not stdout. Stdout is the LSP protocol wire.
- Never use `console.log()` or write arbitrary text to stdout in stdio mode. A single stray stdout write can corrupt the LSP stream.
- Use `connection.console.error / warn / info / log` for LSP-protocol-aware logging (surfaces in client log windows).
- Use direct `process.stderr.write` for pre-connection bootstrap logging only.
- Log levels: `debug` (verbose, off by default), `info` (index stats, startup), `warn` (skipped components, parse errors), `error` (handler crashes, server errors).
- Never log the full document text &mdash; it can be large and is never useful in logs.

### LSP implementation patterns

- Bootstrap with `createConnection(ProposedFeatures.all)` before any other stdout activity, then create `TextDocuments(TextDocument)` and call `documents.listen(connection)`.
- Prefer `textDocumentSync: TextDocumentSyncKind.Incremental` or the equivalent object form with `openClose: true`; do not build the server around full-document sync.
- For hot paths, prefer cached document state over reparsing on every request. The target model is: parse on change, query many times.
- `onInitialize` must return quickly and only declare capabilities plus high-level workspace support. Do not start indexing, file watching, or dynamic registrations there.
- `onInitialized` is where dynamic registrations happen: `workspace/didChangeConfiguration`, `workspace/didChangeWatchedFiles`, and workspace-folder hooks.
- Prefer `workspaceFolders` over deprecated `rootPath`. For the MVP, select one active workspace root deterministically and log that multi-root indexing is deferred; keep the surrounding design ready for a later workspace-index implementation.
- Long-running handlers should accept `CancellationToken` and check `token.isCancellationRequested` after every `await`. Return early when cancelled instead of finishing stale work.
- If future synchronous CPU-heavy analysis is introduced, add yield points (`setImmediate`) or move the work to worker threads. Never block the event loop in a per-keystroke path.
- Debounced validation and index refresh must discard stale queued work so older async passes cannot overwrite newer state.
- Diagnostics should include `version` where the client/library supports it, and async results must be dropped if the current document version no longer matches the version that started the work.
- Completion lists should stay lightweight: return fast labels/details first, and move expensive documentation generation to `completionItem/resolve` where practical.
- Completion providers should be small pure sub-providers returning `CompletionItem[]`, with one orchestration layer deciding which providers run for a given context.
- File/path resolution helpers should return `undefined`/`null` on expected misses and log at the edge; they should not throw for normal resolution failures.
- Use `MarkupContent` / Markdown for rich completion and hover documentation, but keep the initial payload small.

### Completion conventions

- Recommended trigger characters for this project: `:`, `"`, `'`, `@`, `/`.
- Use `CompletionItemKind.Module` for SDC component IDs, `CompletionItemKind.File` for Twig namespace paths, and `CompletionItemKind.Property` for props/slots.
- Use `sortText` to keep exact and required matches first, `filterText` when the visible label differs from what should match, and `preselect` only for the single most likely first choice.
- Set `isIncomplete: true` only when the server intentionally returns a partial list that should be recomputed as the user types; otherwise prefer complete deterministic lists.

### Testing Requirements

**Unit tests (`packages/core`):**
- YAML parser: valid full metadata; missing `name`; missing `props`; missing `slots`; completely malformed YAML; empty file; valid YAML but wrong shape (array instead of object); twig file missing from disk.
- Workspace scanner: nested `components/` directories; directories with no `.component.yml`; directories with `.component.yml` but no `.twig` pair; symlinked directories; permission error on a subdirectory; empty root directory; root directory does not exist.
- Registry: add components; lookup by ID (hit + miss); lookup by provider; partial name search; full re-index atomic swap; concurrent read during rebuild.
- Context detector: cursor inside `with {}` on same line; cursor before `with`; cursor after closing `}`; multi-line `with {}` (must return null gracefully); component ID with hyphens; unknown component ID in include.

**Integration tests (`packages/language-server`):**
- Full LSP `initialize`/`initialized` handshake with a real server child process. Tests must send both messages in order; many dynamic registrations do not occur until `initialized`.
- `textDocument/completion` with `{% include '` at cursor &rarr; assert fixture component IDs are present.
- `textDocument/definition` on a known component ID &rarr; assert response points to correct fixture `.twig` file.
- `textDocument/definition` on an unknown ID &rarr; assert `null` response, no crash.
- File watcher: write a new `.component.yml` file during test, assert it appears in completions within 1 second.
- Malformed request (missing params) &rarr; assert server responds with LSP error, does not exit.
- Diagnostics tests must listen for `textDocument/publishDiagnostics` notifications; diagnostics are notifications, not request responses.
- Test client `processId` must be `process.pid` or `null`, never a fake arbitrary integer.
- Server shutdown: send `shutdown` + `exit` &rarr; assert process exits cleanly with code 0.
- Capture and inspect `stderr` from the spawned child process so crashes and logging regressions fail the test.

**Fixture requirements:**
- All tests use real files from `fixtures/` &mdash; no invented YAML strings in test files.
- `fixtures/example/` must contain at minimum: 3 atoms, 3 molecules, 2 organisms, 1 shared/layout component.
- At least one fixture with no props, one with no slots, one with both, one intentionally malformed YAML.
- Fixtures are committed to the repository so CI has no dependency on `pas-drupal`.

### Additional QA Test Scenarios

- **Server restart recovery**: Send `shutdown` + `exit`, spawn a new server process, send a second `initialize` — assert clean re-initialization with no state from the previous session.
- **Large workspace benchmark (CI)**: Add a vitest benchmark that generates 500 synthetic `.component.yml` fixture files in a temp directory and asserts cold indexing completes in under 2 seconds. This must run in CI to catch performance regressions.
- **Unicode in paths**: Test that component IDs and file paths containing non-ASCII characters (e.g. accented characters in a theme name) do not cause parse failures or crashes.
- **Windows path separators**: The provider inference algorithm in `parser.ts` uses `filePath.split(path.sep)`. On Windows `path.sep` is `\\`. Add a test that parses a Windows-style path (`C:\\project\\themes\\custom\\mytheme\\components\\atoms\\button\\button.component.yml`) and asserts the provider is correctly inferred as `"mytheme"`. Use `path.posix` / `path.win32` explicitly in the split to ensure cross-platform correctness.
- **Concurrent file events**: Test that when 15 `.component.yml` files change simultaneously (simulating a `git checkout`), the global bulk-event debounce fires a single full rebuild rather than 15 individual re-parses.

### Code Quality Requirements

- TypeScript strict mode (`strict: true`) throughout all packages. No exceptions.
- No `any` types. If an escape hatch is genuinely required, it must be marked with a comment: `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- [reason]`.
- All public API functions must have JSDoc comments with `@param` and `@returns` tags.
- No circular dependencies between packages. Enforce with `madge --circular` in CI. Rule: `core` has no LSP deps; `language-server` depends on `core`; `vscode-client` depends on `language-server` binary only.
- No `setTimeout` for sequencing logic. Use `Promise`-based patterns.
- No IIFE patterns. Drupal&rsquo;s JS init order is handled by the runtime.
- All `async` functions must have their errors handled at the call site. No floating promises.

---

## 6. Task List

---
## TASK-001: Monorepo scaffold with pnpm workspaces + TypeScript
**Phase:** 1  
**Depends on:** none  
**Effort:** ~2 hours  
**Priority:** critical

### Context
Before any language server logic can be written, the project needs a correctly structured monorepo that all subsequent tasks build on. This task creates the root workspace, the three packages (`core`, `language-server`, `vscode-client`), shared TypeScript configuration with strict mode, `tsup` for building, `vitest` for testing, and workspace-level scripts. Getting the dependency graph right here &mdash; particularly ensuring `core` has zero LSP dependencies &mdash; prevents expensive restructuring later. Circular dependency detection must be automated so it cannot regress silently.

### Acceptance criteria
- [ ] Root `package.json` uses pnpm workspaces with `packages/*` glob
- [ ] `pnpm-workspace.yaml` lists `packages/*`
- [ ] Root `tsconfig.base.json`: `strict: true`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, `declaration: true`, `declarationMap: true`
- [ ] Each package has its own `package.json` and `tsconfig.json` extending `../../tsconfig.base.json`
- [ ] `packages/core/package.json` has zero dependencies on `vscode-languageserver` or any editor SDK
- [ ] `packages/language-server` lists `@drupal-sdc-lsp/core` as a workspace dependency (`workspace:*`)
- [ ] `packages/vscode-client` has a stub `src/extension.ts` (empty `activate`/`deactivate` exports) for Phase 1
- [ ] Root scripts: `build` (tsup all packages in order), `test` (vitest workspace), `dev` (watch mode), `clean` (remove all `dist/`)
- [ ] `tsup` configured per-package with `entry: ["src/index.ts"]` (or `src/server.ts` for language-server), `format: ["cjs"]`, `dts: true`
- [ ] Vitest configured in workspace mode with a root `vitest.config.ts`
- [ ] `madge --circular packages/*/src` passes with zero circular dependencies
- [ ] `.editorconfig`: `indent_size = 2`, `end_of_line = lf`, `insert_final_newline = true`
- [ ] `.gitignore`: excludes `node_modules/`, `dist/`, `*.js.map`, `.DS_Store`, `*.vsix`
- [ ] `README.md` stub: project name, one-line description, `pnpm install && pnpm build` quick-start
- [ ] `packages/language-server/package.json` has a `"bin": { "drupal-sdc-lsp": "./dist/server.js" }` field
- [ ] `dist/server.js` has a shebang line `#!/usr/bin/env node` as its first line (handled via tsup `banner` option)
- [ ] `vscode-uri` is listed as a dependency in `packages/language-server` (for cross-platform URI/path conversion across all editors)
- [ ] `ts-lsp-client` is listed as a devDependency at the workspace root (for cleaner LSP integration tests — abstracts JSON-RPC framing)

### Technical notes
- Use `tsup` over raw `tsc -b` for a cleaner DX: it handles declaration files, source maps, and watch mode in one command.
- Install `madge` as a dev dependency at the root. Add a `check:deps` script: `madge --circular packages/*/src`. Run this in CI.
- The `yaml` npm package (not `js-yaml`) must be in `packages/core/package.json` only. Never install it in `language-server` &mdash; it imports from `core`.
- `vscode-languageserver` and `vscode-languageserver-textdocument` belong in `packages/language-server` only.
- Use `workspace:*` protocol for inter-package deps so pnpm resolves them as symlinks during development.
- Keep `packages/language-server` ready for canonical LSP bootstrap: `createConnection(ProposedFeatures.all)` plus `TextDocuments(TextDocument)` with incremental sync.
- Keep the workspace/package split close to Twiggy&rsquo;s successful shape &mdash; pure logic package, thin language-server package, thin editor client package &mdash; but use `tsup` instead of its build tooling.
- The `bin` field enables `npm install -g drupal-sdc-lsp` so users can run `drupal-sdc-lsp --stdio` from any editor. Without this, distribution requires absolute paths.
- Add `banner: { js: '#!/usr/bin/env node' }` to the tsup config for `packages/language-server` to inject the shebang.
- `vscode-uri` must be in `packages/language-server` only (not `packages/core` — core has no editor deps). It handles cross-platform URI/path conversion since different editors encode URIs differently (e.g. `file:///c%3A/` vs `file:///c:/` on Windows).

### Robustness requirements
- The build must fail loudly (non-zero exit code) if any package fails to compile. Do not use `|| true` in build scripts.
- `madge --circular` must run as a pre-test step in CI. A circular dependency introduced in any PR fails the build.
- TypeScript project references (`references` in `tsconfig.json`) must accurately reflect the actual import graph so incremental builds work correctly.

---
## TASK-002: `packages/core` &mdash; Workspace scanner
**Phase:** 1  
**Depends on:** TASK-001  
**Effort:** ~2 hours  
**Priority:** critical

### Context
The server must discover all SDC components in a workspace without being told their exact paths. This task implements a recursive file scanner in `packages/core` that, given a root directory path, walks the filesystem and returns the absolute paths of every `.component.yml` file found under any `components/` subdirectory. This is the first step in the indexing pipeline &mdash; every other feature depends on this list of paths being complete and correct. Real Drupal projects may have symlinks, deeply nested structures, and directories with restricted permissions, all of which must be handled gracefully.

### Acceptance criteria
- [ ] `scanForComponentFiles(rootDir: string): Promise<string[]>` exported from `packages/core`
- [ ] Returns absolute paths of all `*.component.yml` files found anywhere under a `components/` directory within `rootDir`
- [ ] If `rootDir` does not exist: returns `[]`, no throw
- [ ] If `rootDir` exists but contains no components: returns `[]`, no throw
- [ ] Handles `EACCES` on a subdirectory: logs `warn`, skips that directory, continues with siblings
- [ ] Handles `ENOENT` on a directory that disappears mid-scan: logs `debug`, skips, continues
- [ ] Does not follow circular symlinks: tracks visited inodes, skips revisited ones
- [ ] Does follow non-circular symlinks (Drupal projects use them)
- [ ] Tested against `fixtures/example/` &mdash; returns the correct set of paths
- [ ] Scanning 500 component files completes in under 500ms (benchmark with a large fixture set)

### Technical notes
- Use `fs.promises.readdir(dir, { withFileTypes: true })` to get `Dirent` objects. Use `.isDirectory()`, `.isSymbolicLink()`, `.isFile()` for type checking.
- For circular symlink detection: call `fs.promises.realpath()` on each symlink target and track seen real paths in a `Set<string>`.
- The filter for `components/` is intentional: it avoids indexing `.component.yml` files that happen to be in non-SDC locations (e.g. config directories).
- Do not use `glob` or `fast-glob` &mdash; keep `packages/core` dependencies minimal. Pure `fs.promises` is sufficient and avoids a dependency.
- The function signature is intentionally simple (one root dir string). The caller (registry) is responsible for calling it with multiple roots if needed.

### Robustness requirements
- Must not throw under any filesystem error. Every `fs.promises` call must be in a try/catch.
- Circular symlink loop must not cause infinite recursion or hang. The inode tracking `Set` is the guard.
- Must not crash if a file is deleted between `readdir` and a subsequent `stat` call (TOCTOU race): catch `ENOENT`, log `debug`, continue.
- Performance: must not hold the Node.js event loop. All I/O is async/await, no sync filesystem calls.

---
## TASK-003: `packages/core` &mdash; YAML metadata parser
**Phase:** 1  
**Depends on:** TASK-001  
**Effort:** ~2 hours  
**Priority:** critical

### Context
Once we have a list of `.component.yml` file paths, we need to extract structured metadata from each: the component&rsquo;s machine ID, human name, description, props schema, and declared slots. This task implements a YAML parser that reads a single `.component.yml` file and returns a fully typed `ComponentMetadata` object, or `null` on any failure. The typed shape is what the entire rest of the system works with &mdash; getting it right here means downstream code is free of defensive null-checks and raw YAML access.

### Acceptance criteria
- [ ] The following types are exported from `packages/core/src/types.ts`:
  ```ts
  interface ComponentMetadata {
    id: string;              // "example:wysiwyg"
    provider: string;        // "example"
    name: string;            // human-readable from YAML
    description?: string;
    props: PropDefinition[];
    slots: SlotDefinition[];
    twigFilePath: string | null;  // null if .twig file not found on disk
    yamlFilePath: string;
  }

  interface PropDefinition {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    default?: unknown;
  }

  interface SlotDefinition {
    name: string;
    description?: string;
  }
  ```
- [ ] `parseComponentYaml(filePath: string): Promise<ComponentMetadata | null>` exported from `packages/core`
- [ ] Returns `null` (never throws) on: unreadable file, malformed YAML, missing `name` field, file is empty
- [ ] Returns `null` and logs `warn` for: missing `name`, wrong type for `props`/`slots`
- [ ] Missing `props` key: parsed as `[]`, not an error
- [ ] Missing `slots` key: parsed as `[]`, not an error
- [ ] `twigFilePath`: derived by replacing `.component.yml` with `.twig`; if that file does not exist on disk, set to `null` (log `debug`); never throws from the existence check
- [ ] `provider` is inferred from the directory structure: the path segment immediately before `components/` (e.g. `.../themes/custom/mytheme/components/...` &rarr; provider = `"mytheme"`; `.../modules/custom/foo/components/...` &rarr; provider = `"foo"`)
- [ ] Component `id` is `"{provider}:{componentDirectoryName}"`
- [ ] Props are extracted from `props.properties` (YAML object) &mdash; each key becomes a `PropDefinition`
- [ ] Required props are determined by the `props.required` array (standard JSON Schema pattern)
- [ ] Slots are extracted from the `slots` key (YAML object) &mdash; each key becomes a `SlotDefinition`
- [ ] All fixture components parse without returning `null`

### Technical notes
- Use the `yaml` npm package: `import { parse } from 'yaml'`. It throws a descriptive error on malformed YAML &mdash; catch it at the top of `parseComponentYaml`.
- The Drupal SDC `.component.yml` structure:
  ```yaml
  $schema: https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json
  name: Wysiwyg
  description: Rich text content block
  props:
    type: object
    properties:
      content:
        type: string
        description: The HTML content
    required:
      - content
  slots:
    main:
      title: Main slot
      description: The primary content area
  ```
- Provider inference from path: `filePath.split(path.sep)` &rarr; find the index of `"components"` &rarr; the element immediately before it is the provider name. Handle the case where `"components"` does not appear in the path, or is the first segment, by falling back to `"unknown"` with a `warn` log.
- The `default` value for a prop comes from `props.properties[name].default` if present.

### Robustness requirements
- `parseComponentYaml` must never throw. It is called in a loop over potentially hundreds of files; a single throw would abort the entire indexing pass.
- The `fs.promises.access()` check for twig file existence must be in its own try/catch, isolated from the YAML parsing logic.
- Invalid types for `props.properties` (e.g. YAML array instead of object): log `warn`, treat as `[]`.
- The `required` array in the JSON Schema props may be absent; treat as empty array without error.

---
## TASK-004: `packages/core` &mdash; SDC registry
**Phase:** 1  
**Depends on:** TASK-002, TASK-003  
**Effort:** ~2 hours  
**Priority:** critical

### Context
The scanner finds files and the parser extracts metadata. This task wires them together into an `SDCRegistry` &mdash; an in-memory index that the language server queries at request time. The registry must support multiple lookup strategies (by ID, by namespace path, by provider, by partial name for fuzzy completion), must expose a `readyPromise` to prevent race conditions at startup, and must support atomic rebuilds where the old index remains fully readable until a new one is ready to swap in.

### Acceptance criteria
- [ ] `SDCRegistry` class exported from `packages/core`
- [ ] `registry.build(rootDir: string): Promise<void>` &mdash; scans, parses, populates index; resolves `readyPromise`
- [ ] `registry.readyPromise: Promise<void>` &mdash; resolves when initial build completes; used by handlers to avoid race conditions
- [ ] `registry.getById(id: string): ComponentMetadata | undefined` &mdash; e.g. `"example:wysiwyg"`
- [ ] `registry.getByNamespacePath(namespacePath: string): ComponentMetadata | undefined` &mdash; e.g. `"@example/atoms/wysiwyg/wysiwyg.twig"`
- [ ] `registry.getByProvider(provider: string): ComponentMetadata[]`
- [ ] `registry.search(query: string): ComponentMetadata[]` &mdash; case-insensitive substring match on ID and name
- [ ] `registry.getAllComponents(): ComponentMetadata[]`
- [ ] `registry.rebuild(rootDir: string): Promise<void>` &mdash; builds a new index in a temporary map, then atomically swaps; old index readable throughout
- [ ] `registry.updateComponent(yamlFilePath: string): Promise<void>` &mdash; re-parses a single file, updates index entry in-place (for file watcher incremental updates)
- [ ] `registry.removeComponent(yamlFilePath: string): void` &mdash; removes a component from the index by its yaml file path
- [ ] All lookup methods return `undefined`/`[]` (never throw) when component is not found
- [ ] Building from `fixtures/example/` completes without error; `getAllComponents()` returns the expected count

### Technical notes
- Internal stores: `Map<string, ComponentMetadata>` keyed by ID; `Map<string, ComponentMetadata>` keyed by namespace path; `Map<string, ComponentMetadata>` keyed by yaml file path (needed for `updateComponent`/`removeComponent`).
- Namespace path format: `@{provider}/{relativePath}` where `relativePath` is the path of the `.twig` file relative to the `components/` directory. E.g.: `.../example/components/atoms/wysiwyg/wysiwyg.twig` &rarr; `@example/atoms/wysiwyg/wysiwyg.twig`.
- Atomic rebuild: build into a `pendingMap`, then in a single synchronous assignment: `this.indexById = pendingMap`. JavaScript&rsquo;s single-threaded model makes this atomic at the language level.
- Log to stderr (via the logger module): number of components indexed, number of parse failures, total scan duration.
- Export `buildRegistry(rootDir: string): Promise<SDCRegistry>` as a convenience factory.
- Structure the registry so it can evolve to multi-root workspaces cleanly: MVP builds one folder-local registry for one active root, with a thin workspace-index abstraction above it ready for later multi-root support.
- Borrow Twiggy&rsquo;s cache split idea: keep stable lookup structures separated by concern, and define explicit invalidation rules for each so incremental updates cannot accidentally poison unrelated indexes.

### Robustness requirements
- `build()` must catch errors from `scanForComponentFiles` and `parseComponentYaml` individually. A failure on one file must not abort processing of the others.
- `rebuild()` must not leave the registry in an empty state if the new build fails partway through. Swap only on complete success.
- All lookup methods must be synchronous (no I/O). They are called in hot paths (per-keystroke completion).
- `readyPromise` must be a real promise that resolves exactly once. Subsequent calls to `getAllComponents()` after the initial build must not await anything.
- Debounced rebuild/update work must guard against stale completion: an older async refresh must never overwrite a newer registry state.

---
## TASK-005: `packages/language-server` &mdash; stdio LSP bootstrap
**Phase:** 1  
**Depends on:** TASK-004  
**Effort:** ~3 hours  
**Priority:** critical

### Context
This task creates the actual LSP server process. It wires `vscode-languageserver/node` to listen on stdin/stdout, handles the LSP `initialize` handshake (declaring server capabilities to the client), instantiates the `SDCRegistry`, and sets up the document manager. This is the foundation that all provider tasks plug into. Two critical correctness requirements: the `initialize` response must not be blocked by indexing (editors have short timeouts on `initialize`), and all request handlers must be wrapped in try/catch so a bug in one handler cannot crash the entire server.

### Acceptance criteria
- [ ] `packages/language-server/src/server.ts` is the binary entry point
- [ ] Server starts, connects via stdin/stdout, and completes the `initialize`/`initialized` handshake without error
- [ ] `initialize` response is sent **immediately** &mdash; does NOT await the registry build
- [ ] `onInitialized`: starts registry build asynchronously + starts file watcher
- [ ] Bootstrap order is correct: `createConnection(ProposedFeatures.all)` first, then `TextDocuments(TextDocument)`, then handler registration, with no stdout writes before the connection is live
- [ ] Capabilities declared: `textDocumentSync: TextDocumentSyncKind.Incremental` (or object form with `openClose: true`), `completionProvider: { triggerCharacters: ["'", '"', ":", "@", "/"] }`, `definitionProvider: true`, `hoverProvider: true`
- [ ] `connection.onShutdown` and `connection.onExit` handled correctly (clean process exit)
- [ ] All `connection.on*` handlers wrapped in try/catch; errors logged with `connection.console.error`; handler returns null/empty on error, never throws
- [ ] `TextDocuments<TextDocument>` manager configured and listening on the connection
- [ ] Workspace root resolved from `params.workspaceFolders` or `params.rootUri`; `rootPath` is ignored as deprecated input; MVP indexes a single active root while preserving a workspace-index seam for future multi-root support
- [ ] Compiled binary runs as `node dist/server.js --stdio`
- [ ] `:LspLog` in Neovim shows no errors during a normal attach
- [ ] Server parses the `--stdio` argument from `process.argv` at startup; logs a clear error and exits with code 1 if an unrecognised flag is passed
- [ ] A `console.log` redirect is installed at the very top of `server.ts`, before any imports that could trigger stdout output: `console.log = (...args: unknown[]) => console.error('[LOG]', ...args);`
- [ ] Server reads client capabilities from `params.capabilities` in `onInitialize` and only enables features that the client supports (e.g. `textDocument?.publishDiagnostics` before registering diagnostic provider)

### Technical notes
- `createConnection(ProposedFeatures.all)` is the correct stdio invocation; call it before any stdout output.
- Use `URI.parse(uri).fsPath` from `vscode-uri` to convert workspace URI to a filesystem path.
- Keep `server.ts` thin: it imports and calls provider functions from `completion.ts`, `definition.ts`, `hover.ts`, `diagnostics.ts`, `watcher.ts`. It owns only the wiring, not the logic.
- Create a `logger.ts` module that wraps `connection.console` and respects a configurable log level. Pass this into all provider modules as a dependency.
- The `readyPromise` from the registry must be exported and used in all index-backed handlers: `await registry.readyPromise; return doWork()`.
- Dynamic registration belongs in `onInitialized`: watched files, configuration changes, and workspace-folder events.
- The `console.log` redirect is a safety net. A single stray `console.log` from any library — including code run during module initialization — will corrupt the LSP protocol stream. This redirect must be the very first line in `server.ts`.
- Client capability checking: read `params.capabilities.textDocument?.publishDiagnostics`, `params.capabilities.textDocument?.completion?.completionItem?.resolveSupport`, etc. Store these in a `clientCapabilities` variable and pass it to providers so they can conditionally enable features.

### Robustness requirements
- **Never** call `process.exit()` inside a request handler. Exit only in `onExit`.
- If `workspaceFolders` is empty and `rootUri` is null: run with empty registry, send one `window/showMessage` warning to the user (type `Warning`).
- If multiple workspace folders are present, choose one active root deterministically for the MVP, log that multi-root indexing is deferred, and keep the server running.
- An unhandled promise rejection anywhere in the server must be caught by `process.on("unhandledRejection")` and logged to stderr. The server must not crash.
- An uncaught exception anywhere in the server must be caught by `process.on("uncaughtException")`, logged via stderr-safe logging, and then allowed to terminate so the editor/client supervisor can restart cleanly; do not attempt to limp on with potentially corrupted state.
- Never use `console.log()` in stdio mode. Use `connection.console.*` after bootstrap and `process.stderr.write` only before the connection exists.
- The `initialize` response timeout in most editors is 10&ndash;30 seconds. The response must be sent in under 100ms regardless of workspace size.

---
## TASK-006: `packages/language-server` &mdash; completion provider for SDC component IDs
**Phase:** 1  
**Depends on:** TASK-005  
**Effort:** ~3 hours  
**Priority:** critical

### Context
This is the primary user-facing feature of Phase 1. When a developer types `{% include '` in a Twig template, the server offers completion items for all known SDC component IDs (`example:wysiwyg`, `example:card`, etc.). The completion handler must correctly detect whether the cursor is inside a relevant string literal context, query the registry for all components, and return well-formed `CompletionItem` objects. It must await the initial readiness gate for index-backed results, and it must never return completions from a stale document version.

### Acceptance criteria
- [ ] Completion is triggered by `'`, `"`, `:`, `@`, and `/` characters in `.twig` files
- [ ] Completions are offered when cursor is inside the string argument of: `{% include '...' %}`, `{% embed '...' %}`, `{% extends '...' %}` and are computed from the latest `TextDocuments` snapshot
- [ ] Each completion item: label = component ID, kind = `Module`, detail = component `name` from YAML, documentation = Markdown `MarkupContent` when present
- [ ] Inserting a completion item replaces the partial text already typed (use `textEdit` with the correct range)
- [ ] If registry is still building, the handler awaits `readyPromise` before reading from the index; `[]` is returned only when there are no matches, the workspace is empty, or the request is cancelled/stale
- [ ] Completions are NOT offered outside of string literal contexts
- [ ] Completions are NOT offered when the cursor is on a line with a comment (`{# ... #}`)
- [ ] Completion list is drawn from `registry.getAllComponents()` &mdash; reflects the latest index
- [ ] Expensive or verbose docs are deferred to `completionItem/resolve`; the initial completion response stays lightweight
- [ ] `completionProvider` capability declaration includes `resolveProvider: true`
- [ ] `connection.onCompletionResolve` handler is implemented: receives a `CompletionItem` with `data` field containing the component ID, looks it up in the registry, and populates the full `documentation` field with Markdown content
- [ ] The initial completion response stores only the component ID in `item.data`; full docs are deferred to the resolve handler

### Technical notes
- `connection.onCompletion(async (params) => { try { ... } catch(e) { logger.error(e); return []; } })`
- Get the document: `documents.get(params.textDocument.uri)`. If `undefined`, return `[]`.
- Get the line text: `document.getText({ start: { line: params.position.line, character: 0 }, end: params.position })` to get text from line start up to the cursor.
- Context detection regex: `/(?:include|embed|extends)\s*['"]([^'"]*)$/i` &mdash; if the cursor line up to the cursor position matches this, offer SDC ID completions.
- The `textEdit` range should replace from the start of the current partial string to the cursor position. Extract the start of the partial by finding the opening quote.
- `CompletionItemKind.Module` is the correct kind for component/module identifiers.
- Use `sortText` to rank exact and required-first matches, `filterText` when matching should ignore display differences, and `preselect` only for the single best first suggestion.
- Implement SDC completion as a dedicated sub-provider function that returns `CompletionItem[]`; the top-level completion handler should only decide whether this provider applies and merge results.
- This handler will gain additional branches in TASK-011 (path completions) and TASK-014 (prop key completions). Structure it with clear `if/else` branches so they can be added cleanly.
- Version staleness guard pattern:
  ```typescript
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const versionAtRequestTime = doc.version;
  await registry.readyPromise;
  if (documents.get(params.textDocument.uri)?.version !== versionAtRequestTime) return [];
  ```

### Robustness requirements
- Must `await registry.readyPromise` before calling `getAllComponents()`. The await is effectively free after the first resolution.
- Must not crash if the document has been closed between the request arriving and the handler executing (check `documents.get()` return value).
- If the handler awaits async work and the document version changes before results are returned, discard the stale result rather than replying with outdated completions.
- Accept and check `CancellationToken` after each `await`; if cancelled, return `[]` immediately.
- The regex must not be run on very long lines without a guard: if line length exceeds 10,000 characters, return `[]` and log `debug`.
- Never return `null` &mdash; the LSP spec allows `null` but some clients mishandle it. Return `[]` for empty.

---
## TASK-007: `packages/language-server` &mdash; go-to-definition for SDC component IDs
**Phase:** 1  
**Depends on:** TASK-005  
**Effort:** ~2 hours  
**Priority:** high

### Context
When a developer presses &ldquo;go to definition&rdquo; on a component ID like `example:wysiwyg` in a Twig template, the editor should navigate to the component&rsquo;s `.twig` file (preferred) or fall back to its `.component.yml` file. This task implements the `textDocument/definition` handler that extracts the token under the cursor, validates it as a known component ID, and returns an LSP `Location` pointing to the correct file.

### Acceptance criteria
- [ ] `gotoDefinition` resolves a component ID under the cursor to its `.twig` file
- [ ] If `twigFilePath` is `null` (twig file not found), falls back to the `.component.yml` file
- [ ] If the token under the cursor does not match a known component ID: returns `null`
- [ ] If the target file does not exist on disk at response time: returns `null` (validate with `fs.promises.access()`)
- [ ] The returned `Location` range is `{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }` (top of file)
- [ ] Works for component IDs in `include`, `embed`, and `extends` call positions
- [ ] Returns `null` (never throws) for any error

### Technical notes
- Register with `connection.onDefinition(async (params) => { ... })`.
- Extract the token under cursor: get the full line, find word boundaries around `params.position.character` using the regex `[a-z0-9_-]+:[a-z0-9_-]+`. This pattern matches component IDs but not arbitrary strings.
- `registry.getById(token)` &rarr; if `undefined`, return `null`.
- Validate file existence with `fs.promises.access(path, fs.constants.F_OK)` wrapped in try/catch. If it throws, return `null`.
- Convert path to URI: `URI.file(absolutePath).toString()` from `vscode-uri`.
- Do not navigate to the YAML file if the twig file exists &mdash; the twig file is more useful to a developer.

### Robustness requirements
- Do not return a `Location` for a file that does not exist on disk. Editors will show an error if the target file is missing.
- The definition handler must `await registry.readyPromise` before querying.
- Must handle the case where the cursor is at the very start or end of the line (character index 0 or at line length) without an out-of-bounds error.

---
## TASK-008: File watcher &mdash; incremental index refresh
**Phase:** 1  
**Depends on:** TASK-005  
**Effort:** ~2 hours  
**Priority:** high

### Context
The SDC registry is built once on startup, but developers continuously add, rename, and delete component files during a session. Without a file watcher, the server serves stale completions until restarted. This task implements a watcher that monitors `**/*.component.yml` files and triggers targeted incremental updates: re-parsing a single changed file updates only that entry in the registry, rather than rebuilding the entire index. This keeps the update latency under 500ms even for large workspaces.

### Acceptance criteria
- [ ] File watching starts in `onInitialized` (not `onInitialize`)
- [ ] Prefers `workspace/didChangeWatchedFiles` dynamic registration for `**/*.component.yml` files inside workspace folders
- [ ] On file **add**: parse the new file, add it to the registry via `registry.updateComponent(path)`
- [ ] On file **change**: re-parse, update registry entry in-place
- [ ] On file **delete**: remove from registry via `registry.removeComponent(path)`
- [ ] Rename events (which appear as delete + add): handled correctly via the delete + add pair
- [ ] Events are debounced: rapid successive changes to the same file (e.g. editor autosave) trigger only one re-index after a 300ms quiet period
- [ ] After a file change, new completions reflect the updated component within 500ms
- [ ] Watcher is stopped cleanly on server `shutdown`

### Technical notes
- Use `connection.client.register(DidChangeWatchedFilesNotification.type, { watchers: [{ globPattern: "**/*.component.yml" }] })` to delegate watching to the editor client. This is preferable to Node.js `fs.watch` because the client handles platform-specific watching reliably.
- The `DidChangeWatchedFilesNotification` handler receives a list of changes each with `type: FileChangeType.Created | Changed | Deleted`.
- Debounce: maintain a `Map<string, ReturnType<typeof setTimeout>>` from file path to pending timer. On each event, clear any existing timer for that path and set a new 300ms timer.
- **Do not use `setTimeout` for sequencing logic** (per project rules). The debounce here is explicitly for rate-limiting filesystem events, which is an approved use case. All other sequencing must use Promises.
- After `registry.updateComponent()` or `registry.removeComponent()`, no explicit notification to clients is needed for completion/definition &mdash; those are pull-based (request/response). The next request naturally uses the fresh registry.
- In a future multi-root workspace, register watchers per workspace folder or through a workspace-index abstraction; for the MVP, wire the watcher to the single active root selected at startup.

### Robustness requirements
- If `connection.client.register` fails (client doesn&rsquo;t support watched files): fall back to `chokidar` watching via Node.js. Log `info` that falling back to node-based watching.
- If a parse error occurs on a changed file: log `warn`, do not remove the previous version of the component from the registry (keep stale data over having a gap).
- The watcher must be stopped (`.dispose()` on the LSP watcher or `.close()` on chokidar) during server shutdown to prevent dangling handles that block process exit.
- Debounced refreshes must discard stale queued work. If file A changes twice quickly, the older refresh must never overwrite the newer parse result.
- **Bulk event protection**: When a large number of files change simultaneously (e.g. `git checkout` switching branches), the per-file debounce approach can trigger N parallel re-parses. Add a global debounce: if more than 10 file events arrive within 300ms, cancel all individual timers and trigger a single full `registry.rebuild()` after a 500ms quiet period. Log `info` when this threshold is hit.

---
## TASK-009: Neovim integration guide + lspconfig snippet
**Phase:** 1  
**Depends on:** TASK-005, TASK-006, TASK-007  
**Effort:** ~1 hour  
**Priority:** high

### Context
Phase 1 culminates with a working server that Neovim developers can use immediately. This task produces the Lua configuration needed to register `drupal-sdc-lsp` as a custom LSP alongside the corrected `twiggy_language_server` config (which is currently broken in many setups due to `init_options` being nested inside `settings` instead of being a top-level client option) and the `yamlls` config for `.component.yml` validation. The output is a `docs/neovim-setup.md` file that is ready to paste into any Neovim config.

### Acceptance criteria
- [ ] `docs/neovim-setup.md` created with complete, working Lua configuration
- [ ] Covers both modern Neovim &ge;0.11 style (`vim.lsp.config` / `vim.lsp.enable`) and `nvim-lspconfig` style
- [ ] `drupal_sdc_ls` server: correct `cmd`, `filetypes: { "twig" }`, `root_dir` pattern
- [ ] `twiggy_language_server`: corrected config with `init_options` and `root_dir` as **top-level** client options (not under `settings`); `namespaces` config for `example` provider shown
- [ ] `yamlls`: `yaml.schemas` mapping Drupal SDC schema URL to `["**/*.component.yml"]`; `schemaStore.enable: false` to prevent conflicts
- [ ] Guide explains that all three servers coexist on the same `.twig` and `.component.yml` buffers; this is normal and expected
- [ ] Guide includes `:LspInfo` and `:LspLog` as debugging hints
- [ ] Guide includes a troubleshooting section for verifying coexistence: running `drupal-sdc-lsp`, `twiggy_language_server`, and `yamlls` simultaneously on a `.twig` buffer should show all three in `:LspInfo` without errors
- [ ] Guide notes that duplicate completions from multiple servers are normal and expected — the editor merges them

### Technical notes
- `drupal_sdc_ls` cmd: `{ "drupal-sdc-lsp", "--stdio" }` if installed via npm, or `{ "node", "/absolute/path/to/numiko-lsp/packages/language-server/dist/server.js", "--stdio" }` for local development without global install.
- `root_dir`: `vim.fs.root(0, { "composer.json", "docroot", ".git" })` for modern Neovim. For lspconfig: `lspconfig.util.root_pattern("composer.json", "docroot", ".git")`.
- The `twiggy_language_server` bug to document and fix: `init_options` is a top-level lspconfig option that is sent as `params.initializationOptions` in the LSP `initialize` request. If nested under `settings`, it is sent as server settings instead and ignored by the server.
- Drupal SDC schema URL: `https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json`

### Robustness requirements
- The guide must include a troubleshooting section: what to do if no completions appear (check `:LspLog`, verify `build` was run, verify root_dir detection).
- The Lua snippets must be syntactically valid. Test them before committing.

---
## TASK-010: `packages/core` &mdash; Twig template path scanner
**Phase:** 2  
**Depends on:** TASK-004  
**Effort:** ~2 hours  
**Priority:** high

### Context
Phase 1 covers SDC component ID (`provider:component`) completion. Phase 2 adds completion for the long-form Twig namespace path syntax: `@example/atoms/wysiwyg/wysiwyg.twig`. This task extends `packages/core` with a scanner that finds all `.twig` files in the workspace and maps each to its `@namespace/relative/path.twig` string. This index is separate from the SDC component registry because it includes all Twig templates, not only SDC components.

### Acceptance criteria
- [ ] `TwigFileEntry` type exported from `packages/core/src/types.ts`: `{ absolutePath: string; namespacePath: string; provider: string }`
- [ ] `scanForTwigFiles(rootDir: string): Promise<TwigFileEntry[]>` exported from `packages/core`
- [ ] Each entry has: `absolutePath` (absolute filesystem path), `namespacePath` (`@{provider}/relative/from/components-dir/file.twig`), `provider` (inferred from directory structure)
- [ ] Namespace derivation: file path relative to the parent `components/` directory, prefixed with `@{provider}/`
- [ ] Files outside of a `components/` directory tree: included with a best-guess provider from the nearest named ancestor directory (log `debug`), never skipped silently
- [ ] `SDCRegistry.build()` calls `scanForTwigFiles` alongside `scanForComponentFiles`
- [ ] `registry.getByNamespacePath()` returns components found via either scan
- [ ] Tested against `fixtures/example/` &mdash; returns all `.twig` files with correct namespace paths

### Technical notes
- Reuse the same directory-walking logic from TASK-002 (extract to a shared internal `walkDir` utility).
- Provider inference: same algorithm as TASK-003 &mdash; find `"components"` in the path segments, take the element immediately before it.
- Store in a dedicated `Map<string, TwigFileEntry>` inside the registry (separate from the component ID map) to support `@namespace/path` lookups independently of component metadata.
- Define an explicit namespace mapping type inspired by Twiggy &mdash; `{ namespace, directory }` &mdash; and route namespace-path resolution through it instead of scattering string concatenation rules.
- Keep Twig path resolution deterministic: exact namespace match first, then a small documented fallback sequence for non-`components/` Twig files. Never let fallback silently outrank the explicit namespace mapping.

### Robustness requirements
- Same filesystem error handling rules as TASK-002.
- Files with duplicate namespace paths (e.g. two themes providing `@example/atoms/button/button.twig`): log `warn` with both paths, keep the last one indexed (predictable tiebreaker).
- Must handle workspaces with multiple providers (multiple themes/modules with their own `components/` directories).

---
## TASK-011: `packages/language-server` &mdash; `@namespace/path` completion
**Phase:** 2  
**Depends on:** TASK-010, TASK-006  
**Effort:** ~2 hours  
**Priority:** high

### Context
In addition to the `provider:component` shorthand, Drupal Twig templates regularly use the long-form `@namespace/path/to/template.twig` syntax in `include`/`extends`/`embed` calls. This task adds a second completion branch to the existing completion handler that triggers when the cursor is inside a string starting with `@` and returns paths from the Twig file index. The two completion branches (SDC IDs and namespace paths) must coexist without conflict within the same `onCompletion` handler.

### Acceptance criteria
- [ ] Completion triggers when cursor is inside a Twig string starting with `@` in an include/embed/extends context
- [ ] Completions drawn from the Twig file index (all `.twig` files), not just SDC components
- [ ] Results filtered by the prefix already typed: `@example/atoms/` only shows paths under that prefix
- [ ] Results sorted: exact namespace prefix match first, then alphabetical
- [ ] Completion item: label = namespace path, kind = `File`, detail = absolute file path (truncated if long), with lightweight initial payload and optional Markdown docs in resolve
- [ ] Does not return raw filesystem paths &mdash; only namespace-resolved `@namespace/...` strings
- [ ] If Twig file index is empty: return `[]`, log `warn` once (not on every keystroke)

### Technical notes
- Extend the `onCompletion` handler from TASK-006: add an `if (partialInput.startsWith('@'))` branch before the SDC ID branch.
- `CompletionItemKind.File` visually distinguishes path completions from component ID completions in the editor&rsquo;s completion UI.
- Prefix matching: `allTwigFiles.filter(entry => entry.namespacePath.startsWith(partialInput))`.
- The `partialInput` is extracted from the line text: everything after the opening `'` or `"` up to the cursor.

### Robustness requirements
- The `@` detection must not conflict with Twig `@` variable syntax (which is not standard Twig). If the string starts with `@` but is not inside an include/embed/extends: do not offer completions.
- Must `await registry.readyPromise` before querying.
- Accept and check `CancellationToken` after async boundaries; cancelled namespace completion returns `[]`.
- Log the &ldquo;Twig index is empty&rdquo; warning at most once per server session (use a boolean flag) to avoid filling the log on every keystroke.

---
## TASK-012: `packages/language-server` &mdash; hover provider
**Phase:** 2  
**Depends on:** TASK-005, TASK-004  
**Effort:** ~2 hours  
**Priority:** medium

### Context
When a developer hovers over a component ID like `example:wysiwyg` in a Twig template, the editor should show a floating panel with the component&rsquo;s name, description, props table, and slots list. This removes the need to open the `.component.yml` file manually to understand what a component accepts. This task implements the `textDocument/hover` handler that extracts the token under the cursor, looks it up in the registry, and returns formatted Markdown documentation.

### Acceptance criteria
- [ ] Hovering over a valid component ID (`example:wysiwyg`) shows a Markdown tooltip with:
  - `### {ComponentName}` heading
  - Description paragraph (if present)
  - **Props** section: Markdown table with columns: Prop, Type, Required, Description, Default
  - **Slots** section: bulleted list of `\`slot-name\`` &mdash; description
- [ ] If component has no props: shows &ldquo;No props defined.&rdquo; instead of an empty table
- [ ] If component has no slots: shows &ldquo;No slots defined.&rdquo; instead of an empty list
- [ ] If component has neither: shows &ldquo;No props or slots defined.&rdquo;
- [ ] Hover over a `@namespace/path/file.twig` that corresponds to an SDC component: shows same tooltip
- [ ] Hover over text that is not a component ID: returns `null`
- [ ] Returns `null` (never throws) on any error

### Technical notes
- Register with `connection.onHover(async (params) => { ... })`.
- Token extraction: same word-boundary logic as TASK-007 &mdash; extract the `provider:component` pattern under cursor, or the `@namespace/path` pattern.
- Use `MarkupKind.Markdown` in the `Hover` response.
- Prop table row format: `| \`{name}\` | \`{type}\` | {required ? "✓" : ""} | {description ?? ""} | {default ?? ""} |`
- Escape backtick characters in prop names and types that might break Markdown formatting.

### Robustness requirements
- Missing `description` in a prop: show empty string in the table cell, not `undefined`.
- `default` values that are objects or arrays: JSON-stringify them in the table cell.
- Must `await registry.readyPromise` before querying.

---
## TASK-013: `packages/core` &mdash; Twig invocation argument position detector
**Phase:** 3  
**Depends on:** TASK-004  
**Effort:** ~3 hours  
**Priority:** medium

### Context
Phase 3 adds prop key completion inside `with { }` argument blocks: when typing `{% include 'example:card' with { `, the server offers completions for `title`, `image`, `body`, etc. To implement this, the server must detect whether the cursor is inside the `with { }` object for a known component, and identify which component is being called. This task implements that detection logic as a pure function in `packages/core`, where it can be unit-tested independently of the LSP infrastructure.

### Acceptance criteria
- [ ] `InvocationContext` type exported from `packages/core/src/types.ts`:
  ```ts
  interface InvocationContext {
    componentId: string;
    alreadyUsedKeys: string[];
  }
  ```
- [ ] `detectInvocationContext(documentText: string, cursorOffset: number): InvocationContext | null` exported from `packages/core`
- [ ] Returns `InvocationContext` when: cursor is inside `{% include 'example:card' with { ... } %}` after the `{`
- [ ] `alreadyUsedKeys`: keys already present in the `{ }` block before the cursor
- [ ] Returns `null` for: cursor not inside a `with {}` block; ambiguous/unparseable context; empty document
- [ ] Never throws under any input

### Technical notes
- Algorithm: from the cursor offset, search backwards through `documentText` for an opening `{` that is preceded by `with` for an `include`/`embed` invocation. Then search forwards from that `{` to find the component ID string in the preceding `include`/`embed` call.
- A regex that works for single-line cases: `/(?:include|embed)\s+['"]([^'"]+)['"]\s+with\s+\{([^}]*)$/` applied to the text from line start up to cursor.
- For multi-line `with {}` blocks: this regex approach will not work. Document this limitation in a code comment as a known Phase 3 constraint. A tree-sitter based solution is the correct long-term fix.
- `alreadyUsedKeys`: from the `{...}` content up to the cursor, extract keys with `/(\w+)\s*:/g`.
- Accepts `documentText` (full document) and `cursorOffset` (character offset from document start) for accuracy.

### Robustness requirements
- The detector is called on every keystroke in completion-trigger contexts. It must be fast (&lt;1ms for typical line lengths) and must never throw.
- The backwards search must have a maximum lookback distance (e.g. 2000 characters) to prevent O(n) work on very large documents.
- Edge case: cursor is between `with` and `{` (e.g. `with |{`): return `null`, not a crash.

---
## TASK-014: `packages/language-server` &mdash; prop key completion in `with {}` blocks
**Phase:** 3  
**Depends on:** TASK-013, TASK-006  
**Effort:** ~2 hours  
**Priority:** medium

### Context
Once the invocation context detector (TASK-013) can identify that the cursor is inside a `with {}` argument block for a known component, this task adds a completion branch that returns the component&rsquo;s prop and slot names as completion items. This makes writing component includes significantly faster and less error-prone, as developers no longer need to open the `.component.yml` file to recall prop names.

### Acceptance criteria
- [ ] Prop key completions offered when cursor is inside `with {}` after a known component ID
- [ ] Each item: label = prop/slot name, kind = `Property`, detail = type (for props) or `"slot"` (for slots), documentation = description
- [ ] Required props sort before optional props in the list (use `sortText`)
- [ ] Already-typed keys in the current `with {}` block are excluded from suggestions
- [ ] Slot names are included as completion items alongside prop names
- [ ] If component lookup fails: return `[]`, no error; index-backed lookups await `readyPromise` first
- [ ] Does not suggest props from the wrong component

### Technical notes
- Add a third branch to the `onCompletion` handler: `const context = detectInvocationContext(documentText, cursorOffset); if (context) { ... }`.
- `CompletionItemKind.Property` for both prop and slot names; use `detail`/documentation to distinguish slots cleanly without fragmenting the UI.
- `sortText`: `"0_" + propName` for required props, `"1_" + propName` for optional props, `"2_" + slotName` for slots.
- `cursorOffset`: compute from `params.position` using `document.offsetAt(params.position)`.

### Robustness requirements
- Must not suggest props from a different component if the context detection is ambiguous. If `detectInvocationContext` returns `null`, fall through to the next completion branch, not an error.
- Must `await registry.readyPromise` before calling `registry.getById()`.

---
## TASK-015: `packages/language-server` &mdash; diagnostic: unknown SDC component ID
**Phase:** 3  
**Depends on:** TASK-005, TASK-004  
**Effort:** ~3 hours  
**Priority:** medium

### Context
Currently the server provides completions but does not warn developers when they reference a component ID that does not exist in the registry. This task adds a warning diagnostic (squiggly underline) on any `include` or `embed` call that uses an ID not found in the registry. This is the &ldquo;lint&rdquo; pass for SDC usage and closes the loop on the original problem of false &ldquo;template not found&rdquo; errors &mdash; now the server actively validates component references.

### Acceptance criteria
- [ ] Warning diagnostic on the string range of an unknown `provider:component` ID
- [ ] Diagnostic message: `Unknown SDC component: "example:unknown". Check the component is registered and the provider name is correct.`
- [ ] Diagnostics refreshed when a document is opened (`onDidOpen`) or saved (`onDidSave`)
- [ ] No diagnostic on valid, registered component IDs
- [ ] Diagnostics cleared when the invalid ID is corrected
- [ ] Diagnostic passes await the initial readiness gate before resolving IDs, preventing false positives during startup
- [ ] Diagnostics NOT emitted for `@namespace/path/...` style strings (only `provider:component` pattern)
- [ ] Diagnostics NOT emitted for Twig comment lines (`{# ... #}`)
- [ ] Diagnostics NOT emitted for `drupal:*` provider (whitelist of known Drupal core providers)
- [ ] A server configuration option `disableUnknownComponentDiagnostic: true` disables this feature entirely
- [ ] Diagnostic publication uses the current open-document snapshot from `TextDocuments`; if the document is closed or newer content exists, stale async results are dropped
- [ ] Diagnostics include `version` where the client/library supports it

### Technical notes
- `connection.sendDiagnostics({ uri, diagnostics: [] })` to clear; `connection.sendDiagnostics({ uri, diagnostics })` to publish.
- Subscribe to `documents.onDidChangeContent` for live updates (optional, can be too noisy) and `documents.onDidSave` for on-save diagnostics. Use on-save only for Phase 3.
- Pattern to find candidate IDs: `/['"]([a-z0-9_][a-z0-9_-]*:[a-z0-9_][a-z0-9_-]*)['"]/g`. Await `registry.readyPromise` before resolving IDs, then publish diagnostics based on the settled index snapshot.
- Core provider whitelist: `["drupal", "core"]`. Never emit diagnostics for these providers.
- Compute diagnostic `range` from the match index: `document.positionAt(match.index + 1)` to `document.positionAt(match.index + 1 + componentId.length)` (the `+1` skips the opening quote).
- Capture `const requestedVersion = document.version` before async work and compare with `documents.get(uri)?.version` before publishing.

### Robustness requirements
- **Principle of least surprise**: when in doubt, skip the diagnostic. A false positive (warning on a valid component) is far worse UX than a missed warning.
- If the registry rebuilds while diagnostics are being computed: use the registry state captured at the start of the diagnostic pass (take a snapshot of `getAllComponents()` at the top of the handler).
- Dynamic Twig expressions that happen to contain a colon (e.g. `{{ 'en:US' }}`) must not match the pattern. The regex must be anchored to string literal contexts (inside single or double quotes that follow a Twig tag keyword).
- Diagnostic passes should accept `CancellationToken` where available and stop after each `await` if the request became stale.

---
## TASK-016: `packages/vscode-client` &mdash; VS Code extension scaffold
**Phase:** 4  
**Depends on:** TASK-005  
**Effort:** ~3 hours  
**Priority:** high

### Context
Phase 4 makes `drupal-sdc-lsp` available to VS Code users without manual LSP configuration. This task creates the thin VS Code extension in `packages/vscode-client` that spawns `packages/language-server` as a child process and connects to it via `vscode-languageclient`. All language intelligence lives in the server; this package is only the launcher, wiring, and error presenter. Use `microsoft/vscode-extension-samples/lsp-sample` as the canonical reference for this wiring.

### Acceptance criteria
- [ ] `packages/vscode-client/src/extension.ts` exports `activate(context: ExtensionContext)` and `deactivate()`
- [ ] On `activate`: resolves `serverPath` relative to `__dirname`, creates `ServerOptions` and `LanguageClientOptions`, starts `LanguageClient`
- [ ] `ServerOptions`: `{ run: { command: "node", args: [serverPath, "--stdio"] }, debug: { command: "node", args: [serverPath, "--stdio", "--inspect"] } }`
- [ ] `LanguageClientOptions.documentSelector`: `[{ scheme: "file", language: "twig" }, { scheme: "file", pattern: "**/*.component.yml" }]`
- [ ] Extension activates on `onLanguage:twig` and `workspaceContains:**/*.component.yml`
- [ ] On server crash: auto-restart up to 3 times; after 3 failures, show VS Code error notification with a link to open `:LspLog` equivalent (Output Channel)
- [ ] On `deactivate`: `client.stop()` called cleanly
- [ ] Extension can be installed locally via `vsce package` + `code --install-extension drupal-sdc-lsp-*.vsix`
- [ ] If `serverPath` does not exist (extension not built): show clear error message, not a silent failure

### Technical notes
- Use `vscode-languageclient/node` (the client SDK). Do not confuse with `vscode-languageserver/node` (the server SDK).
- `serverPath`: `path.join(__dirname, "..", "..", "language-server", "dist", "server.js")` in the monorepo. In the packaged `.vsix`, the server dist must be bundled alongside (see TASK-018).
- The `languageClient.start()` returns a `Promise<void>`. Await it in `activate` to catch early connection errors.
- Create a named Output Channel: `vscode.window.createOutputChannel("drupal-sdc-lsp")` and pass it to the client for log output.
- Use `microsoft/vscode-extension-samples/lsp-sample` as the authoritative reference for the exact constructor signatures.

### Robustness requirements
- Extension must never crash VS Code. All errors in `activate` must be caught and shown via `vscode.window.showErrorMessage`.
- If the server process dies 3 times: stop auto-restarting, show a persistent notification, and provide a &ldquo;Reload Window&rdquo; action button.
- Validate that `serverPath` exists with `fs.existsSync` before attempting to start. If missing: show a message explaining the user needs to run `pnpm build` in the `drupal-sdc-lsp` repo.

---
## TASK-017: Extension settings
**Phase:** 4  
**Depends on:** TASK-016  
**Effort:** ~2 hours  
**Priority:** medium

### Context
Some Drupal projects have components spread across multiple themes or contributed modules. Others need to override the auto-detected provider name. This task adds VS Code workspace settings that are passed as `initializationOptions` to the language server on startup, and corresponding server-side handling to consume them.

### Acceptance criteria
- [ ] Extension contributes `drupal-sdc-lsp.componentPaths` (array of strings, default: `[]`) &mdash; additional directories to scan for `.component.yml` files
- [ ] Extension contributes `drupal-sdc-lsp.providerName` (string, default: `""`) &mdash; override provider name; empty means auto-detect
- [ ] Extension contributes `drupal-sdc-lsp.disableUnknownComponentDiagnostic` (boolean, default: `false`)
- [ ] Extension contributes `drupal-sdc-lsp.logLevel` (enum: `"off" | "error" | "warn" | "info" | "debug"`, default: `"info"`)
- [ ] All settings have descriptions in `package.json`&rsquo;s `contributes.configuration` section
- [ ] Settings are read via `vscode.workspace.getConfiguration("drupal-sdc-lsp")` and passed as `initializationOptions`
- [ ] Language server reads `params.initializationOptions` in `onInitialize` and applies: additional scan paths, provider name override, diagnostic toggle, log level
- [ ] Invalid settings (wrong type): log `warn`, use default value &mdash; never crash

### Technical notes
- Pass settings as: `LanguageClientOptions.initializationOptions: () => vscode.workspace.getConfiguration("drupal-sdc-lsp")`.
- In `server.ts`: `const options = params.initializationOptions ?? {}`. Use `typeof options.logLevel === "string"` guards before use.
- Re-read settings and send `workspace/didChangeConfiguration` if the user changes settings after startup (VS Code does this automatically via the `LanguageClient`).

### Robustness requirements
- All settings must have safe defaults. The server must be fully functional with zero configuration.
- Settings validation at the server boundary: treat unexpected types as &ldquo;not provided&rdquo; and log `warn`.

---
## TASK-018: Publish to VS Code Marketplace
**Phase:** 4  
**Depends on:** TASK-016, TASK-017  
**Effort:** ~2 hours  
**Priority:** low

### Context
The final Phase 4 task makes `drupal-sdc-lsp` publicly available to VS Code users worldwide. This task covers packaging the extension (bundling the server dist alongside the extension), configuring all Marketplace metadata, and setting up a CI step to publish on tag push. The extension README is the primary piece of user-facing documentation for VS Code users.

### Acceptance criteria
- [ ] `packages/vscode-client/package.json`: `publisher`, `repository`, `license`, `icon` (128&times;128 PNG), `categories: ["Other"]`, `engines.vscode: "^1.85.0"`, `activationEvents`
- [ ] `.vscodeignore` correctly excludes source files, test files, and node_modules while including `dist/` and bundled server files
- [ ] Extension bundles the compiled `language-server` dist: `vsce package` produces a `.vsix` that works standalone (no external build step required after install)
- [ ] `packages/vscode-client/README.md` covers: what the extension does, prerequisites (Node.js), installation, settings reference, troubleshooting
- [ ] GitHub Actions workflow: on push to a tag matching `v*`, runs `pnpm build`, `vsce package`, `vsce publish`
- [ ] `vsce package` completes without warnings in CI on every PR (packaging regression check)

### Technical notes
- Use `@vscode/vsce` for packaging/publishing.
- To bundle the language server: in `packages/vscode-client`, add a `postinstall` or `webpack`/`esbuild` step that copies `../language-server/dist/**` into `dist/server/`. Update `serverPath` in `extension.ts` accordingly.
- The extension icon must be a 128&times;128 PNG. SVG is not accepted by the VS Code Marketplace.
- GitHub Actions: use `VSCE_PAT` secret for the publish token.

### Robustness requirements
- The published `.vsix` must be self-contained: it must work after a clean install with no `pnpm install` by the user.
- Bumping the version should happen via a script (`pnpm version patch`) that updates all relevant `package.json` files consistently.

---
## TASK-019: npm publish pipeline + distribution setup
**Phase:** 1 (do alongside TASK-009 — needed for distribution)
**Depends on:** TASK-001, TASK-005
**Effort:** ~1 hour
**Priority:** high

### Context
For `drupal-sdc-lsp` to be installable by any developer via `npm install -g drupal-sdc-lsp`, the package must be correctly configured for npm publication. This task ensures the `packages/language-server` package has all the metadata npm requires, that the build produces a correctly shebang'd entry point, and that a CI workflow exists for publishing. Without this, every user must clone the repo and use absolute paths, which is a major barrier to adoption.

### Acceptance criteria
- [ ] `packages/language-server/package.json` has:
  - `"name": "drupal-sdc-lsp"` (the public npm package name)
  - `"version"` field following semver (start at `0.1.0` for pre-stable)
  - `"description"`: `"Language Server Protocol (LSP) server for Drupal Single Directory Components (SDC) — autocomplete, go-to-definition, and hover docs for Twig templates"`
  - `"keywords"`: `["drupal", "sdc", "twig", "lsp", "language-server", "single-directory-components", "neovim", "vscode"]`
  - `"license"`: `"MIT"` (or appropriate)
  - `"repository"` pointing to the GitHub repo
  - `"bin": { "drupal-sdc-lsp": "./dist/server.js" }`
  - `"files"`: `["dist/"]` — only publish the compiled output, not source
  - `"engines"`: `{ "node": ">=18" }`
  - `"main"`: `"./dist/server.js"`
- [ ] `dist/server.js` has `#!/usr/bin/env node` as first line (via tsup `banner` config)
- [ ] Root `package.json` has a `"private": true` field so the workspace root is not accidentally published
- [ ] `packages/core/package.json` has `"private": true` — core is not published separately; it is bundled into the language server
- [ ] `packages/vscode-client/package.json` has `"private": true` until Phase 4 readies it for publication
- [ ] `.npmignore` or `"files"` field ensures source TypeScript, test files, and fixtures are excluded from the published package
- [ ] A GitHub Actions workflow `.github/workflows/publish.yml` publishes to npm when a new git tag matching `v*.*.*` is pushed
- [ ] Manual publish works: `cd packages/language-server && npm publish --dry-run` completes without errors
- [ ] After global install (`npm install -g drupal-sdc-lsp`), `drupal-sdc-lsp --stdio` starts the server and completes an LSP `initialize` handshake

### Technical notes
- tsup config for `packages/language-server`: add `banner: { js: '#!/usr/bin/env node' }` to inject the shebang at the top of the bundle.
- The `"files"` field in package.json is simpler and more explicit than `.npmignore`. Use `"files": ["dist/"]`.
- GitHub Actions publish example:
  ```yaml
  name: Publish
  on:
    push:
      tags: ['v*.*.*']
  jobs:
    publish:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: '20'
            registry-url: 'https://registry.npmjs.org'
        - run: npm install -g pnpm && pnpm install && pnpm build
        - run: cd packages/language-server && npm publish
          env:
            NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
  ```
- Use `"version": "0.1.0"` for the initial pre-stable release. Bump to `1.0.0` after Phase 3 (diagnostics) is complete and the server has been validated in production.

### Robustness requirements
- The publish workflow must run `pnpm build` before publishing — never publish without building first.
- Dry-run check (`npm publish --dry-run`) must be run in CI on every PR to catch packaging errors before they reach npm.
- The `engines.node` field prevents users from installing on Node.js versions that are too old to run the server.

---
## TASK-020: Test fixtures from `pas-drupal`
**Phase:** 1 (parallel)
**Depends on:** none
**Effort:** ~1 hour
**Priority:** critical

### Context
All tests and manual verification depend on realistic, representative component data. Rather than inventing fake `.component.yml` files in test files, this task copies a curated subset of real components from the `pas-drupal` project (`/Users/nmkadmin/Developer/pas-drupal/docroot/themes/custom/mytheme/components/`) into `fixtures/example/`. These fixtures are the authoritative source of truth for all unit and integration tests and are committed to the repository so CI has no dependency on the private `pas-drupal` codebase.

### Acceptance criteria
- [ ] `fixtures/example/atoms/` &mdash; at least 3 atom components (e.g. `button`, `tag`, `icon`)
- [ ] `fixtures/example/molecules/` &mdash; at least 3 molecule components (e.g. `card`, `media`, `teaser`)
- [ ] `fixtures/example/organisms/` &mdash; at least 2 organism components (e.g. `hero`, `listing`)
- [ ] `fixtures/example/shared/` &mdash; at least 1 shared/layout component
- [ ] At least one component with props and no slots
- [ ] At least one component with slots and no props
- [ ] At least one component with both props and slots
- [ ] At least one component with no props and no slots
- [ ] `fixtures/example/malformed/malformed.component.yml` &mdash; a deliberately malformed YAML file (for negative testing)
- [ ] `fixtures/example/malformed/no-name.component.yml` &mdash; a valid YAML file missing the `name` field
- [ ] Each component directory contains both `.component.yml` and `.twig` files (paired)
- [ ] `fixtures/README.md` documents: source project, purpose, how to update fixtures

### Technical notes
- Source: `cp -r /Users/nmkadmin/Developer/pas-drupal/docroot/themes/custom/mytheme/components/{atoms,molecules,organisms} fixtures/example/`
- Review copied files for sensitive content (customer data, internal URLs) before committing. Replace any sensitive values with generic placeholder text.
- The malformed YAML fixture should be: valid file extension, invalid YAML syntax (e.g. unmatched indentation or a tab character in a YAML value).
- Fixture `.twig` files can be simplified (template body does not need to be complete Twig &mdash; just enough to verify the file exists and has correct content).

### Robustness requirements
- Fixtures must stay in sync with the parser&rsquo;s expected YAML structure. If the Drupal SDC schema changes in a future Drupal version, fixtures should be updated to match.
- The `malformed/` directory must never contain files that accidentally parse correctly. Add a test assertion that `parseComponentYaml("fixtures/example/malformed/malformed.component.yml")` returns `null`.

---
## TASK-021: Unit tests for `packages/core`
**Phase:** 1 (parallel)
**Depends on:** TASK-002, TASK-003, TASK-004, TASK-020
**Effort:** ~3 hours
**Priority:** critical

### Context
`packages/core` contains all parsing and indexing logic that every other feature depends on. Unit tests here catch regressions early, verify edge-case handling (malformed YAML, missing files, permission errors, empty inputs), and serve as living documentation of the expected behaviour. Tests run against real fixture files from TASK-019 so they verify real-world data, not invented strings.

### Acceptance criteria
- [ ] Tests written using Vitest (`describe`/`it`/`expect`)
- [ ] Test files in `packages/core/src/__tests__/`: `scanner.test.ts`, `parser.test.ts`, `registry.test.ts`, `context-detector.test.ts`
- [ ] **Scanner tests:**
  - Given `fixtures/example/`, returns all `.component.yml` paths
  - Non-existent root dir: returns `[]`
  - Directory with no `.component.yml` files: returns `[]`
  - Simulated `EACCES` (mock `fs.promises.readdir` to throw): function returns `[]`, does not throw
  - Symlink to a non-existent target: skipped gracefully
- [ ] **Parser tests:**
  - Valid full metadata (atom fixture): returns correct `ComponentMetadata` with all fields
  - Component with no `props` key: `props` is `[]`
  - Component with no `slots` key: `slots` is `[]`
  - Component with no `props` or `slots`: both are `[]`
  - Missing `name` field: returns `null`
  - Malformed YAML (from malformed fixture): returns `null`
  - Empty file: returns `null`
  - Twig file not on disk: `twigFilePath` is `null`, does not throw
- [ ] **Registry tests:**
  - `build()` from `fixtures/example/`: no errors, `getAllComponents()` returns expected count
  - `getById("example:button")`: returns correct metadata
  - `getById("example:nonexistent")`: returns `undefined`
  - `getByProvider("example")`: returns all example components
  - `search("card")`: returns components whose ID or name contains &ldquo;card&rdquo;
  - `updateComponent()` with a changed fixture: reflected in next `getById()` call
  - `removeComponent()`: component no longer returned by `getById()`
- [ ] **Context detector tests:**
  - Cursor inside `with {}` on same line: returns correct `InvocationContext`
  - Cursor before `with`: returns `null`
  - Cursor after closing `}`: returns `null`
  - `alreadyUsedKeys` correctly extracted from partial `{ title: "foo", ` text
  - Empty document text: returns `null`
  - Very long line (&gt;10,000 chars): returns `null` without hanging
- [ ] All tests pass: `pnpm test --filter @drupal-sdc-lsp/core`
- [ ] Test coverage for `packages/core` is above 80%

### Technical notes
- Fixture path resolution: `import { resolve } from "path"; const FIXTURES = resolve(__dirname, "../../../../fixtures/example");`
- For `EACCES` simulation: use `vi.spyOn(fs.promises, "readdir").mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }))`. Restore after the test.
- Do not mock the filesystem for positive tests &mdash; test against real fixture files. Real-file tests are faster than mocking and catch path-handling bugs.
- Use `vitest`&rsquo;s `test.each` for the parser edge cases to avoid repetitive test boilerplate.

### Robustness requirements
- Tests must be deterministic: no dependency on filesystem state outside `fixtures/`. No network calls.
- Tests must clean up any files they create during test execution.
- CI must fail if any test fails. Do not use `.only` or `.skip` in committed test code.

---
## TASK-022: Integration tests for LSP server
**Phase:** 1 (parallel)
**Depends on:** TASK-005, TASK-006, TASK-007, TASK-020
**Effort:** ~3 hours
**Priority:** critical

### Context
Unit tests verify the indexing logic in isolation. Integration tests verify that the full LSP server &mdash; as a real running process &mdash; responds correctly to LSP protocol messages from a simulated client. This is the highest-confidence signal that Phase 1 is working end-to-end. The test spawns the actual server binary, sends real JSON-RPC messages over stdin/stdout, and asserts responses contain the expected data from the fixture set.

### Acceptance criteria
- [ ] `packages/language-server/src/__tests__/integration.test.ts` exists
- [ ] Test harness: spawns `node packages/language-server/dist/server.js --stdio` as a child process; wraps stdin/stdout with `createMessageConnection` from `vscode-jsonrpc/node`
- [ ] **Test: initialize handshake** &mdash; `initialize` request with `rootUri` or `workspaceFolders` pointing at `fixtures/` returns `InitializeResult` with `completionProvider`, `definitionProvider`, `hoverProvider` in capabilities, followed by an `initialized` notification
- [ ] **Test: completion &mdash; SDC IDs** &mdash; open a virtual `test.twig` document with content `{% include '`; send `textDocument/completion` with cursor after the `'`; assert response contains completion items for all fixture components (by ID)
- [ ] **Test: completion &mdash; partial match** &mdash; content `{% include 'example:b`; assert completions are filtered to only IDs starting with `example:b`
- [ ] **Test: go-to-definition &mdash; hit** &mdash; document containing `example:button`; `textDocument/definition` at the token; assert response `uri` ends with `button.twig`
- [ ] **Test: go-to-definition &mdash; miss** &mdash; token `example:nonexistent`; assert response is `null`
- [ ] **Test: file watcher** &mdash; copy a new `.component.yml` into a temp directory that is the workspace root; assert the new component ID appears in completions within 1500ms
- [ ] **Test: diagnostics notification** &mdash; open/save a document with an unknown component ID; listen for `textDocument/publishDiagnostics` and assert the warning arrives as a notification, not a response payload
- [ ] **Test: malformed request** &mdash; send a `textDocument/completion` request with missing `textDocument` param; assert server responds with an LSP error response and does not exit
- [ ] **Test: shutdown** &mdash; send `shutdown` request then `exit` notification; assert child process exits with code 0 within 2 seconds
- [ ] All tests pass: `pnpm test --filter @drupal-sdc-lsp/language-server`
- [ ] CI must build the server (`pnpm build`) before running integration tests (the dist must exist)
- [ ] Test harness spawns `node packages/language-server/dist/server.js --stdio` (or `drupal-sdc-lsp --stdio` if installed globally)
- [ ] Test client sends `processId: process.pid` or `null`, never a fake placeholder PID
- [ ] Test harness captures and asserts `stderr` stays free of unexpected crashes / protocol corruption

### Technical notes
- Use `vscode-jsonrpc/node`&rsquo;s `createMessageConnection(childProcess.stdout, childProcess.stdin)` to get typed send/receive. Install `vscode-jsonrpc` as a dev dependency.
- Open a virtual document: send `textDocument/didOpen` with `{ textDocument: { uri: "file:///tmp/test.twig", languageId: "twig", version: 1, text: "..." } }` before sending completion requests.
- Await responses using a simple `Promise` wrapper: `sendRequest(method, params)` returns a `Promise` that resolves on the next response with matching `id`.
- The file watcher test should use `os.tmpdir()` for the workspace root and write a fixture-style `.component.yml` there during the test. Clean up after the test.
- Set a test timeout of 10 seconds for the file watcher test to account for slow CI environments.
- After all tests: send `shutdown` + `exit`, then `await childProcess` to wait for clean exit. Use `afterAll`.
- Wire child-process `stderr` into the test harness so unexpected `uncaughtException`, `unhandledRejection`, or stray logging can fail fast.
- Add fast provider-level tests alongside the full subprocess suite, inspired by Twiggy&rsquo;s `documentFromCode()` helper: build real parsed documents from inline Twig code, then call completion/definition helpers directly for cheap, deterministic coverage.

### Robustness requirements
- Tests must kill the child process in `afterAll` even if assertions fail (`child.kill()` in a `finally` block).
- The integration test suite must not leave orphaned server processes. Use a `beforeAll`/`afterAll` pattern with a single shared server process per test file, not one per test.
- Integration tests must be run against the **compiled** `dist/server.js`, not the TypeScript source. The CI `test` script must run `build` first.
- Do not fake the LSP lifecycle. If `initialized` is omitted, tests may pass while dynamic registrations and watcher flows are actually broken.

---

## 7. Neovim Quick-Start

This section provides the complete Lua configuration to run all three servers concurrently on Twig and YAML files. Two styles are shown: **modern Neovim &ge;0.11** (preferred, using `vim.lsp.config` and `vim.lsp.enable`) and **nvim-lspconfig** (for setups already using lspconfig).

`twiggy_language_server` and `drupal_sdc_ls` will both attach to `.twig` files. **This is intentional.** They serve entirely different purposes and do not conflict:
- `drupal_sdc_ls` &mdash; SDC component ID completion, go-to-definition, props/slots hover
- `twiggy_language_server` &mdash; general Twig syntax features, non-SDC template resolution
- `yamlls` &mdash; YAML validation and schema enforcement on `.component.yml` files

---

### Modern Neovim &ge;0.11 (Recommended)

```lua
-- ~/.config/nvim/lsp/drupal_sdc_ls.lua
-- (Neovim 0.11+ auto-loads files in lsp/ as server configs)

vim.lsp.config("drupal_sdc_ls", {
  cmd = {
    -- If installed globally via npm: { "drupal-sdc-lsp", "--stdio" }
    -- For local development, use the absolute path below:
    "node",
    vim.fn.expand("~/Developer/numiko-lsp/packages/language-server/dist/server.js"),
    "--stdio",
  },
  filetypes = { "twig" },
  root_dir = function(bufnr, on_dir)
    local root = vim.fs.root(bufnr, { "composer.json", "docroot", ".git" })
    if root then on_dir(root) end
  end,
  single_file_support = true,
})
```

```lua
-- ~/.config/nvim/lsp/twiggy_language_server.lua
--
-- IMPORTANT: root_dir and init_options are TOP-LEVEL keys of the server config.
-- A common mistake is to nest them under `settings`, where they are silently
-- ignored because `settings` maps to workspace/didChangeConfiguration, not
-- the initialize request. init_options must be at the top level to be sent
-- correctly as params.initializationOptions.

vim.lsp.config("twiggy_language_server", {
  filetypes = { "twig" },
  root_dir = function(bufnr, on_dir)
    local root = vim.fs.root(bufnr, { "composer.json", "docroot", ".git" })
    if root then on_dir(root) end
  end,
  -- TOP-LEVEL: sent as params.initializationOptions in the initialize request.
  init_options = {
    -- Twig namespace configuration. Adjust paths to match your Drupal project.
    namespaces = {
      {
        namespace = "example",
        paths = {
          "docroot/themes/custom/mytheme/templates",
          "docroot/themes/custom/mytheme/components",
        },
      },
    },
  },
})
```

```lua
-- ~/.config/nvim/lsp/yamlls.lua

vim.lsp.config("yamlls", {
  filetypes = { "yaml" },
  settings = {
    yaml = {
      schemas = {
        -- Map Drupal's SDC JSON Schema to all .component.yml files:
        ["https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json"] = "**/*.component.yml",
      },
      -- Disable schemaStore to prevent conflicts with the above explicit mapping:
      schemaStore = {
        enable = false,
        url = "",
      },
    },
  },
})
```

```lua
-- ~/.config/nvim/init.lua (or wherever you enable LSP servers)

vim.lsp.enable({
  "drupal_sdc_ls",
  "twiggy_language_server",
  "yamlls",
})
```

---

### nvim-lspconfig Style (Alternative)

For setups using `nvim-lspconfig`, adapt the above as follows:

```lua
local lspconfig = require("lspconfig")
local lspconfig_configs = require("lspconfig.configs")

-- ─── drupal-sdc-lsp ───────────────────────────────────────────────────────────
-- drupal-sdc-lsp is not built into lspconfig, so register it as a custom config:

if not lspconfig_configs.drupal_sdc_ls then
  lspconfig_configs.drupal_sdc_ls = {
    default_config = {
      cmd = {
        -- If installed globally via npm: { "drupal-sdc-lsp", "--stdio" }
        -- For local development, use the absolute path below:
        "node",
        vim.fn.expand("~/Developer/numiko-lsp/packages/language-server/dist/server.js"),
        "--stdio",
      },
      filetypes = { "twig" },
      root_dir = lspconfig.util.root_pattern("composer.json", "docroot", ".git"),
      single_file_support = true,
    },
  }
end

lspconfig.drupal_sdc_ls.setup({
  on_attach = function(client, bufnr)
    -- Your standard keymaps: vim.keymap.set("n", "gd", ...), etc.
  end,
  capabilities = require("cmp_nvim_lsp").default_capabilities(),
})

-- ─── twiggy_language_server ───────────────────────────────────────────────────

lspconfig.twiggy_language_server.setup({
  -- root_dir and init_options are TOP-LEVEL keys (NOT under settings):
  root_dir = lspconfig.util.root_pattern("composer.json", "docroot", ".git"),
  init_options = {
    namespaces = {
      {
        namespace = "example",
        paths = {
          "docroot/themes/custom/mytheme/templates",
          "docroot/themes/custom/mytheme/components",
        },
      },
    },
  },
  on_attach = function(client, bufnr)
    -- Your standard keymaps
  end,
})

-- ─── yamlls ───────────────────────────────────────────────────────────────────

lspconfig.yamlls.setup({
  settings = {
    yaml = {
      schemas = {
        ["https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json"] = "**/*.component.yml",
      },
      schemaStore = {
        enable = false,
        url = "",
      },
    },
  },
  on_attach = function(client, bufnr)
    -- Your standard keymaps
  end,
})
```

---

### Troubleshooting

| Symptom | Check |
|---|---|
| No completions appearing | Run `:LspInfo` &mdash; verify `drupal_sdc_ls` is listed as attached. Run `:LspLog` &mdash; look for parse errors. Verify `pnpm build` was run in the `numiko-lsp` repo. |
| `drupal_sdc_ls` not attaching | Verify `root_dir` detects the workspace: run `:lua print(vim.lsp.buf.list_workspace_folders())`. Check the `cmd` path exists. |
| `twiggy_language_server` not resolving templates | Confirm `init_options` is a top-level key in the setup table, not nested inside `settings`. |
| `.component.yml` schema errors | Check `yamlls` is attached to the buffer: `:LspInfo`. Verify `schemaStore.enable` is `false`. |
| Server crashes on startup | Run the server manually: `node ~/Developer/numiko-lsp/packages/language-server/dist/server.js --stdio` and look at stderr output. |

---

## 8. Open Questions &amp; Future Ideas

The following features have been intentionally deferred. They are not in scope for Phases 1&ndash;4 but may be worth addressing once the MVP is stable.

**Drupal multi-site support**  
The MVP targets a single workspace root with a single active index. Multi-site Drupal installations may have multiple `docroot/` directories or multiple theme providers active simultaneously. The workspace-index abstraction keeps the architecture ready for this, but the UX implications for conflicting component IDs need careful thought before multi-root support is enabled.

**Module-provided components**  
Phase 1&ndash;3 focus on theme-provided components. Drupal contributed modules (e.g. `drupal:toolbar`) also provide SDC components. Indexing these would require knowing which modules are installed in the Drupal project &mdash; either by reading `composer.json` for installed packages or by scanning `web/modules/contrib/*/components/`. This is achievable but adds scan complexity and requires handling the `drupal:*` provider namespace correctly.

**Storybook integration**  
Many SDC component sets are documented in Storybook. A future feature could read Storybook story files (`.stories.ts`) to enrich hover documentation with usage examples. This would require detecting Storybook in the workspace and parsing story exports &mdash; non-trivial but high-value for design-system teams.

**`component()` Twig function (contrib module)**  
The `{{ component('example:card', { title: '...' }) }}` syntax is provided by a contributed Drupal module, not Drupal core. Supporting it properly requires detecting whether the module is present and handling the slightly different argument structure. Currently deferred as it affects a smaller subset of projects.

**Rename refactoring for component IDs**  
An LSP `textDocument/rename` handler could rename a component ID across all Twig files in the workspace when the component directory is renamed. This requires: finding all usages of the old ID, computing text edits for each, and returning a `WorkspaceEdit`. High-value but complex to implement safely.

**Auto-generate `.component.yml` from Twig variables**  
Inspired by `qed42/twig-sdc-yaml-generator`: given an existing `.twig` template that uses variables, automatically infer a `.component.yml` schema. This would require parsing Twig variable usage patterns &mdash; a use case for the tree-sitter grammar integration. Potentially a VS Code Code Action rather than a background feature.

**Performance: tree-sitter for cursor position detection**  
The regex-based context detection in TASK-013 has known limitations with multi-line `with {}` blocks. The long-term solution is using `tree-sitter` with the `tree-sitter-twig` grammar for accurate AST-based cursor position detection. Deferred to Phase 3+ once the regex approach&rsquo;s limitations become painful in practice.
