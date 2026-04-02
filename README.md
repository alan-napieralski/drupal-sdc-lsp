# drupal-sdc-lsp

A Language Server Protocol (LSP) server for **Drupal Single Directory Components (SDC)** in Twig templates.

Provides editor-agnostic intelligence — works in Neovim, VS Code, and any LSP-capable editor.

---

## Features

### SDC Component Completions
Type `{% include '` or `{% embed '` and get autocomplete for all SDC component IDs in your workspace (`mytheme:card`, `mytheme:button`, etc.). The server recursively scans every `components/` directory, infers the provider from the path, and builds a live index.

### Go-to-Definition
Press your editor's go-to-definition key on any component ID (e.g. `mytheme:card`) and jump directly to the component's `.twig` file.

### Hover Documentation
Hover over any component ID to see its name, description, props table (with types and required fields), and slots list — rendered from the component's `.component.yml`.

### Semantic Token Highlighting
Twig keywords (`extends`, `block`, `if`, `for`, `include`, `set`, `macro`, `with`, etc.) are highlighted as `keyword` tokens via LSP semantic tokens. Colors match your theme's `@lsp.type.keyword` group — identical to `twiggy_language_server`, so disabling twiggy doesn't change your syntax colors.

### Twig Snippet Completions

**Tag snippets** — triggered by typing `{%` then a partial keyword:

| Trigger | Expands to |
|---------|-----------|
| `{% include` | `{% include 'provider:component' %}` |
| `{% include ... with` | `{% include 'provider:component' with { key: value } %}` |
| `{% embed` | `{% embed 'provider:component' %}...{% endembed %}` |
| `{% embed ... with` | `{% embed 'provider:component' with { key: value } %}...{% endembed %}` |
| `{% extends` | `{% extends 'template' %}` |
| `{% if` | `{% if condition %}...{% endif %}` |
| `{% if` / else | `{% if condition %}...{% else %}...{% endif %}` |
| `{% if` / elseif | `{% if condition %}...{% elseif condition %}...{% else %}...{% endif %}` |
| `{% for` | `{% for item in items %}...{% endfor %}` |
| `{% for` / else | `{% for item in items %}...{% else %}...{% endfor %}` |
| `{% block` | `{% block name %}...{% endblock %}` |
| `{% set` | `{% set variable = value %}` |
| `{% set` block | `{% set variable %}...{% endset %}` |
| `{% macro` | `{% macro name(args) %}...{% endmacro %}` |
| `{% apply` | `{% apply filter %}...{% endapply %}` |
| `{% filter` | `{% filter filter %}...{% endfilter %}` |
| `{% with` | `{% with { key: value } %}...{% endwith %}` |
| `{% with only` | `{% with { key: value } only %}...{% endwith %}` |
| `{% verbatim` | `{% verbatim %}...{% endverbatim %}` |
| `{% import` | `{% import 'template' as alias %}` |
| `{% from` | `{% from 'template' import macro %}` |
| `{% use` | `{% use 'template' %}` |
| `{% trans` | `{% trans %}...{% endtrans %}` |
| `{% cache` | `{% cache key %}...{% endcache %}` |

**Word shorthands** — type anywhere in the file (no `{%` required):

| Type | Gets |
|------|------|
| `incl` | include snippet |
| `inclw` | include with snippet |
| `emb` | embed snippet |
| `embw` | embed with snippet |
| `ext` | extends snippet |
| `if` | if/endif snippet |
| `for` | for/endfor snippet |
| `blo` | block/endblock snippet |
| `se` | set snippet |
| `mac` | macro/endmacro snippet |
| `app` | apply/endapply snippet |
| `wit` | with/endwith snippet |
| `fil` | filter/endfilter snippet |
| `tra` | trans/endtrans snippet |
| `cac` | cache/endcache snippet |
| `imp` | import snippet |
| `fro` | from/import snippet |
| `use` | use snippet |
| `ver` | verbatim/endverbatim snippet |

### Live File Watching
New or modified `.component.yml` files are picked up automatically — no server restart required. Changes appear in completions within ~500ms.

---

## Why use this alongside twiggy?

`twiggy_language_server` is a great general-purpose Twig LSP but has gaps this server fills:

| Feature | twiggy | drupal-sdc-lsp |
|---------|--------|----------------|
| SDC component ID completions (`mytheme:card`) | ✗ | ✓ |
| Go-to-definition for SDC components | ✗ | ✓ |
| Hover docs from `.component.yml` | ✗ | ✓ |
| `{% include '...' with { } %}` snippet | Partial (function form only) | ✓ |
| `{% embed %}` snippet | ✗ | ✓ |
| `{% embed with %}` snippet | ✗ | ✓ |
| Generic Twig snippets (if/for/block/set…) | ✓ | ✓ (configurable) |
| Semantic token highlighting | ✓ | ✓ |

Both servers can run simultaneously on the same `.twig` files — they do not conflict.

---

## Installation

### npm (recommended)

```bash
npm install -g drupal-sdc-lsp
```

Verify:
```bash
drupal-sdc-lsp --stdio
# Hangs waiting for LSP input — Ctrl+C to exit
```

### Local development build

```bash
git clone https://github.com/your-org/drupal-sdc-lsp
cd drupal-sdc-lsp
pnpm install
pnpm build
# Binary: packages/language-server/dist/server.js
```

---

## Neovim Setup

### Neovim >= 0.11 (native `vim.lsp.config`)

Create `~/.config/nvim/lsp/drupal_sdc_ls.lua`:

```lua
vim.lsp.config('drupal_sdc_ls', {
  cmd = { 'drupal-sdc-lsp', '--stdio' },
  filetypes = { 'twig' },
  root_markers = { 'composer.json', 'docroot', '.git' },
})
```

Enable in `init.lua`:

```lua
vim.lsp.enable('drupal_sdc_ls')
```

For a local build, replace `cmd` with:
```lua
cmd = { 'node', '/absolute/path/to/packages/language-server/dist/server.js', '--stdio' },
```

### nvim-lspconfig

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.drupal_sdc_ls then
  configs.drupal_sdc_ls = {
    default_config = {
      cmd = { 'drupal-sdc-lsp', '--stdio' },
      filetypes = { 'twig' },
      root_dir = lspconfig.util.root_pattern('composer.json', 'docroot', '.git'),
      single_file_support = false,
    },
  }
end

lspconfig.drupal_sdc_ls.setup({})
```

---

## Configuration

Pass options via `init_options`:

```lua
-- Neovim >= 0.11
vim.lsp.config('drupal_sdc_ls', {
  cmd = { 'drupal-sdc-lsp', '--stdio' },
  filetypes = { 'twig' },
  root_markers = { 'composer.json', 'docroot', '.git' },
  init_options = {
    -- Set false if twiggy_language_server is also running
    -- SDC snippets (include/embed/extends) are always available regardless
    enableGenericTwigSnippets = false,
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableGenericTwigSnippets` | `boolean` | `true` | Show generic Twig snippets (if/for/block/set/macro…). Set `false` when running alongside `twiggy_language_server` to avoid duplicates. SDC-specific snippets (`include`, `embed`, `extends`) are always shown regardless of this setting. |

---

## Running alongside twiggy and yamlls

All three servers can attach to the same `.twig` buffer simultaneously:

```lua
-- drupal-sdc-lsp: SDC component awareness
vim.lsp.config('drupal_sdc_ls', {
  cmd = { 'drupal-sdc-lsp', '--stdio' },
  filetypes = { 'twig' },
  root_markers = { 'composer.json', 'docroot', '.git' },
  init_options = { enableGenericTwigSnippets = false },
})

-- twiggy: general Twig intelligence
vim.lsp.config('twiggy_language_server', {
  cmd = { 'twiggy-language-server', '--stdio' },
  filetypes = { 'twig' },
  root_markers = { 'composer.json', 'docroot', '.git' },
  init_options = {
    namespaces = {
      {
        label = 'mytheme',
        paths = { 'web/themes/custom/mytheme/components' },
      },
    },
  },
})

-- yamlls: .component.yml schema validation
vim.lsp.config('yamlls', {
  filetypes = { 'yaml' },
  settings = {
    yaml = {
      schemas = {
        ['https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json'] = '*.component.yml',
      },
    },
  },
})

vim.lsp.enable({ 'drupal_sdc_ls', 'twiggy_language_server', 'yamlls' })
```

> **Note:** `init_options` must be a top-level key in `vim.lsp.config` — not nested under `settings`. This is a common misconfiguration with `twiggy_language_server`.

---

## How it works

The server scans your workspace for all `components/` directories recursively. Each `.component.yml` file it finds is parsed and indexed. The provider name is inferred from the directory segment immediately before `components/` — so `themes/custom/mytheme/components/atoms/button/button.component.yml` becomes `mytheme:button`.

**Component ID format:** `{provider}:{machine-name}` (e.g. `mytheme:card`, `shared:icon`)

**Namespace path format:** `@{provider}/{relative-path}.twig` (e.g. `@mytheme/atoms/button/button.twig`)

---

## Project structure

```
drupal-sdc-lsp/
├── packages/
│   ├── core/               # Scanner, parser, registry — editor-agnostic
│   │   └── src/
│   │       ├── scanner.ts          # Recursive .component.yml discovery
│   │       ├── parser.ts           # YAML parsing + provider inference
│   │       ├── registry.ts         # In-memory component index (atomic swap)
│   │       ├── context-detector.ts # Cursor context detection
│   │       └── types.ts            # Shared TypeScript types
│   └── language-server/    # LSP server (stdio transport)
│       └── src/
│           ├── server.ts           # LSP bootstrap + handler registration
│           ├── completion.ts       # SDC completions + Twig snippets
│           ├── definition.ts       # Go-to-definition
│           ├── hover.ts            # Hover documentation
│           ├── semantic-tokens.ts  # Keyword semantic highlighting
│           ├── twig-snippets.ts    # All Twig snippet definitions
│           └── watcher.ts          # File system watcher (incremental reindex)
├── fixtures/
│   └── example/            # Test fixture components (example provider)
└── docs/
    └── neovim-setup.md     # Full Neovim setup guide
```

---

## Development

```bash
pnpm install
pnpm build       # Build all packages
pnpm test        # Run unit + integration tests
```

Tests use [vitest](https://vitest.dev/) and run against fixtures in `fixtures/example/`.

---

## Debugging in Neovim

```vim
:LspInfo    " Shows attached servers and capabilities
:LspLog     " Opens LSP log — look for drupal-sdc-lsp entries
```

Log messages to expect on healthy startup:
- `[info] drupal-sdc-lsp initialized. Indexing: /your/project`
- `[info] Registry built: N components indexed`

---

## Roadmap

- **Phase 2** — Prop/slot key completions inside `with { }` blocks; `@namespace/path.twig` completions
- **Phase 3** — Diagnostics for unknown component IDs
- **Phase 4** — VS Code extension wrapper
