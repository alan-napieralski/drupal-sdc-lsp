# Neovim Setup Guide — drupal-sdc-lsp

This guide covers how to connect `drupal-sdc-lsp` to Neovim, alongside `twiggy_language_server` and `yaml-language-server` for a complete Drupal SDC development environment.

---

## Prerequisites

- **Node.js** >= 18 (check: `node --version`)
- **pnpm** (for local dev build) or **npm** (for global install)
- **Neovim** >= 0.9 recommended; >= 0.11 for the native `vim.lsp.config` style

---

## 1. Install the Server

### Option A: Global npm install (recommended for daily use)

```bash
npm install -g drupal-sdc-lsp
```

Verify the installation:

```bash
drupal-sdc-lsp --stdio
# Should hang waiting for input — press Ctrl+C to exit
```

### Option B: Local development build

```bash
cd /path/to/numiko-lsp
pnpm install
pnpm build
```

The built server binary is at `packages/language-server/dist/server.cjs`.

---

## 2. Neovim >= 0.11 Style (vim.lsp.config + vim.lsp.enable)

Create the file `~/.config/nvim/lsp/drupal_sdc_ls.lua`:

```lua
-- ~/.config/nvim/lsp/drupal_sdc_ls.lua

-- Option A: globally installed via npm
vim.lsp.config('drupal_sdc_ls', {
  cmd = { 'drupal-sdc-lsp', '--stdio' },
  filetypes = { 'twig' },
  root_markers = { 'composer.json', 'docroot', '.git' },
})

-- Option B: local development build (uncomment and set your path)
-- vim.lsp.config('drupal_sdc_ls', {
--   cmd = { 'node', '/absolute/path/to/numiko-lsp/packages/language-server/dist/server.cjs', '--stdio' },
--   filetypes = { 'twig' },
--   root_markers = { 'composer.json', 'docroot', '.git' },
-- })
```

Then enable the server in your Neovim config (`init.lua`):

```lua
vim.lsp.enable('drupal_sdc_ls')
```

---

## 3. nvim-lspconfig Style (Neovim < 0.11 or lspconfig users)

If you use [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig), register `drupal_sdc_ls` as a custom server:

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.drupal_sdc_ls then
  configs.drupal_sdc_ls = {
    default_config = {
      -- Option A: globally installed
      cmd = { 'drupal-sdc-lsp', '--stdio' },

      -- Option B: local dev build
      -- cmd = { 'node', '/absolute/path/to/numiko-lsp/packages/language-server/dist/server.cjs', '--stdio' },

      filetypes = { 'twig' },
      root_dir = lspconfig.util.root_pattern('composer.json', 'docroot', '.git'),
      single_file_support = false,
    },
  }
end

lspconfig.drupal_sdc_ls.setup({})
```

---

## 4. Configuration Options

`drupal-sdc-lsp` accepts options via `init_options` (passed as `initializationOptions` in the LSP handshake):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableGenericTwigSnippets` | `boolean` | `true` | Include generic Twig snippets (if/for/block/set/macro etc.) in completions |

**When to disable `enableGenericTwigSnippets`**: If you use `twiggy_language_server` alongside `drupal-sdc-lsp`, both servers provide generic Twig snippets. Set this to `false` to defer to twiggy for generic snippets and avoid duplicates.

> **Note:** Disabling this option does **not** remove SDC-specific snippets. `include`, `include with`, `embed`, `embed with`, and `extends` are always available — these fill gaps that `twiggy_language_server` does not cover (twiggy's `include` uses function syntax only; `embed` and `with` variants are absent).

```lua
-- nvim-lspconfig: disable generic snippets when running alongside twiggy
lspconfig.drupal_sdc_ls.setup({
  init_options = {
    enableGenericTwigSnippets = false,
  },
})

-- vim.lsp.config style (Neovim >= 0.11)
vim.lsp.config('drupal_sdc_ls', {
  cmd = { 'drupal-sdc-lsp', '--stdio' },
  filetypes = { 'twig' },
  root_markers = { 'composer.json', 'docroot', '.git' },
  init_options = {
    enableGenericTwigSnippets = false,
  },
})
```

---

## 5. Three-Server Coexistence

For a full Drupal SDC development environment, run all three servers simultaneously:

- **`drupal-sdc-lsp`** — SDC component IDs, go-to-definition, hover docs
- **`twiggy_language_server`** — General Twig syntax, template resolution
- **`yaml-language-server`** — JSON Schema validation of `.component.yml` files

All three servers can attach to the same `.twig` and `.component.yml` buffers simultaneously. This is expected and normal. Each server contributes different features without conflict.

### Complete three-server lspconfig configuration

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

-- 1. drupal-sdc-lsp: SDC component awareness
if not configs.drupal_sdc_ls then
  configs.drupal_sdc_ls = {
    default_config = {
      cmd = { 'drupal-sdc-lsp', '--stdio' },
      filetypes = { 'twig' },
      root_dir = lspconfig.util.root_pattern('composer.json', 'docroot', '.git'),
    },
  }
end

lspconfig.drupal_sdc_ls.setup({})

-- 2. twiggy_language_server: general Twig features
--    IMPORTANT: init_options is a TOP-LEVEL option, NOT nested under settings.
--    If placed under settings, it is sent as server settings instead of
--    initializationOptions and is silently ignored by the server.
lspconfig.twiggy_language_server.setup({
  filetypes = { 'twig' },
  root_dir = lspconfig.util.root_pattern('composer.json', 'docroot', '.git'),
  -- Correct: init_options is top-level
  init_options = {
    namespaces = {
      {
        label = 'numiko',
        paths = { 'web/themes/custom/numiko/components' },
      },
    },
  },
})

-- 3. yaml-language-server: .component.yml schema validation
lspconfig.yamlls.setup({
  filetypes = { 'yaml' },
  settings = {
    yaml = {
      schemaStore = {
        -- Disable auto-fetching to avoid conflicts with manual schema mapping
        enable = false,
      },
      schemas = {
        -- Map the Drupal SDC JSON Schema to all .component.yml files
        ['https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json'] = '**/*.component.yml',
      },
    },
  },
})
```

### Modern Neovim >= 0.11 three-server configuration

Create three files in `~/.config/nvim/lsp/`:

**`~/.config/nvim/lsp/drupal_sdc_ls.lua`**:
```lua
vim.lsp.config('drupal_sdc_ls', {
  cmd = { 'drupal-sdc-lsp', '--stdio' },
  filetypes = { 'twig' },
  root_markers = { 'composer.json', 'docroot', '.git' },
})
```

**`~/.config/nvim/lsp/twiggy_language_server.lua`**:
```lua
vim.lsp.config('twiggy_language_server', {
  cmd = { 'twiggy-language-server', '--stdio' },
  filetypes = { 'twig' },
  root_markers = { 'composer.json', 'docroot', '.git' },
  init_options = {
    namespaces = {
      {
        label = 'numiko',
        paths = { 'web/themes/custom/numiko/components' },
      },
    },
  },
})
```

**`~/.config/nvim/lsp/yamlls.lua`**:
```lua
vim.lsp.config('yamlls', {
  cmd = { 'yaml-language-server', '--stdio' },
  filetypes = { 'yaml' },
  root_markers = { 'composer.json', '.git' },
  settings = {
    yaml = {
      schemaStore = { enable = false },
      schemas = {
        ['https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json'] = '**/*.component.yml',
      },
    },
  },
})
```

Then in `init.lua`:
```lua
vim.lsp.enable({ 'drupal_sdc_ls', 'twiggy_language_server', 'yamlls' })
```

### About duplicate completions

When multiple servers are attached to the same buffer, the editor merges their completion lists. You may see duplicate items from `drupal-sdc-lsp` and `twiggy_language_server` — this is expected and normal. Each server contributes from its own knowledge base.

---

## 6. Drupal SDC Schema URL

For reference, the official Drupal SDC JSON Schema used for `.component.yml` validation is:

```
https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json
```

---

## 7. Debugging

### Check server status

```vim
:LspInfo
```

This shows all active LSP clients on the current buffer, their root directory, and capabilities. You should see `drupal_sdc_ls` listed when editing a `.twig` file.

### Check server logs

```vim
:LspLog
```

This opens the LSP log file. Look for errors from `drupal-sdc-lsp`. Common log messages:

- `[info] Registry built: N components indexed` — successful startup
- `[warn] Could not read component YAML` — a `.component.yml` file has a parse error
- `[warn] No workspace root found` — the server could not determine your project root

### Common issues

**No completions appearing**

1. Run `:LspInfo` and confirm `drupal_sdc_ls` is listed as attached to the buffer
2. Check `:LspLog` for any errors
3. Verify the server is built: `node /path/to/dist/server.cjs --stdio` should start without errors
4. Check that your `root_dir`/`root_markers` pattern matches your project — the server needs to detect a workspace root to scan for components
5. Confirm your components are in a `components/` directory (e.g. `web/themes/custom/numiko/components/`)

**Server not attaching**

1. Confirm `filetypes = { 'twig' }` matches your buffer's filetype (check with `:set filetype?`)
2. Confirm the `cmd` binary is on your PATH: `which drupal-sdc-lsp`
3. For local dev builds: use the full absolute path in `cmd`

**Three servers all show in :LspInfo**

This is correct and expected. All three servers (`drupal_sdc_ls`, `twiggy_language_server`, `yamlls`) are designed to coexist. Running them simultaneously provides the most complete development experience.

**twiggy_language_server not recognising namespaces**

Ensure `init_options` is a **top-level** option in your lspconfig setup, not nested inside `settings`. This is a common misconfiguration — if placed under `settings`, the value is sent as server settings instead of `initializationOptions` in the LSP `initialize` request and is silently ignored by the server.
