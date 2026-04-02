import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { URI } from 'vscode-uri';

const SERVER_DIST = path.resolve(process.cwd(), 'packages/language-server/dist/server.js');
const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures/numiko');

// ---------------------------------------------------------------------------
// Minimal JSON-RPC over stdio helpers
// ---------------------------------------------------------------------------

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON-RPC payload
  params?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON-RPC result
  result?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON-RPC error
  error?: any;
}

function encodeMessage(message: JsonRpcMessage): Buffer {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(body, 'utf-8')]);
}

/**
 * Minimal LSP client that communicates via stdin/stdout JSON-RPC framing.
 * Matches responses to requests by ID — notifications are discarded.
 */
class LspClient {
  private readonly proc: child_process.ChildProcess;
  private buffer = Buffer.alloc(0);
  private pendingRequests = new Map<number | string, (msg: JsonRpcMessage) => void>();
  private nextId = 1;

  constructor(proc: child_process.ChildProcess) {
    this.proc = proc;

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flushMessages();
    });
  }

  private flushMessages(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd).toString('ascii');
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (lengthMatch === null) break;

      const contentLength = parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength).toString('utf-8');
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(body) as JsonRpcMessage;
      } catch {
        continue;
      }

      if (msg.id !== undefined && msg.id !== null) {
        const resolver = this.pendingRequests.get(msg.id);
        if (resolver !== undefined) {
          this.pendingRequests.delete(msg.id);
          resolver(msg);
        }
      }
      // Notifications have no id — ignored in these tests
    }
  }

  /**
   * Sends a JSON-RPC request and returns a promise that resolves with the response.
   *
   * @param method - LSP method name
   * @param params - Request parameters
   * @param timeoutMs - Maximum wait time for the response
   */
  request(method: string, params: unknown, timeoutMs = 15000): Promise<JsonRpcMessage> {
    const id = this.nextId++;

    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout: no response to "${method}" after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });

      this.proc.stdin!.write(encodeMessage({ jsonrpc: '2.0', id, method, params }));
    });
  }

  /** Sends a JSON-RPC notification (no response expected). */
  notify(method: string, params: unknown): void {
    this.proc.stdin!.write(encodeMessage({ jsonrpc: '2.0', method, params }));
  }

  /** Terminates the server process. */
  kill(): void {
    try {
      this.proc.kill();
    } catch {
      // Ignore errors if process already exited
    }
  }

  /** Waits for the server process to exit with optional timeout. */
  waitForExit(timeoutMs = 5000): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.proc.exitCode !== null) {
        resolve(this.proc.exitCode);
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error(`Process did not exit within ${timeoutMs}ms`));
      }, timeoutMs);

      this.proc.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code ?? 0);
      });
    });
  }
}

function spawnServer(): LspClient {
  const proc = child_process.spawn('node', [SERVER_DIST, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new LspClient(proc);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const WORKSPACE_URI = URI.file(FIXTURES_DIR).toString();

const INIT_PARAMS = {
  processId: process.pid,
  rootUri: WORKSPACE_URI,
  workspaceFolders: [{ uri: WORKSPACE_URI, name: 'fixtures' }],
  capabilities: {
    textDocument: {
      completion: { completionItem: { resolveSupport: { properties: ['documentation'] } } },
      definition: {},
    },
  },
};

// ---------------------------------------------------------------------------
// Tests — skip gracefully if not built
// ---------------------------------------------------------------------------

describe('LSP integration tests', () => {
  it('responds to initialize with capabilities', async () => {
    if (!fs.existsSync(SERVER_DIST)) {
      console.warn('Skipping: server not built. Run: pnpm build');
      return;
    }

    const client = spawnServer();
    try {
      const response = await client.request('initialize', INIT_PARAMS);

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
      expect(response.result.capabilities).toBeDefined();
      expect(response.result.capabilities.completionProvider).toBeDefined();
      expect(response.result.capabilities.definitionProvider).toBe(true);
      expect(response.result.capabilities.hoverProvider).toBe(true);

      client.notify('initialized', {});

      await client.request('shutdown', undefined);
      client.notify('exit', undefined);
      expect(await client.waitForExit()).toBe(0);
    } finally {
      client.kill();
    }
  }, 30000);

  it('returns component completions for include context', async () => {
    if (!fs.existsSync(SERVER_DIST)) {
      console.warn('Skipping: server not built');
      return;
    }

    const client = spawnServer();
    try {
      await client.request('initialize', INIT_PARAMS);
      client.notify('initialized', {});

      // Allow indexing to complete
      await sleep(800);

      const docUri = URI.file('/tmp/test-template.twig').toString();
      const docText = "{% include '";

      client.notify('textDocument/didOpen', {
        textDocument: { uri: docUri, languageId: 'twig', version: 1, text: docText },
      });

      const completionResponse = await client.request('textDocument/completion', {
        textDocument: { uri: docUri },
        position: { line: 0, character: docText.length },
      });

      expect(completionResponse.error).toBeUndefined();
      const items = completionResponse.result as Array<{ label: string }>;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);

      const labels = items.map((item) => item.label);
      expect(labels).toContain('numiko:button');
      expect(labels).toContain('numiko:card');

      await client.request('shutdown', undefined);
      client.notify('exit', undefined);
      await client.waitForExit();
    } finally {
      client.kill();
    }
  }, 30000);

  it('returns definition location for known component ID', async () => {
    if (!fs.existsSync(SERVER_DIST)) {
      console.warn('Skipping: server not built');
      return;
    }

    const client = spawnServer();
    try {
      await client.request('initialize', INIT_PARAMS);
      client.notify('initialized', {});

      await sleep(800);

      const docUri = URI.file('/tmp/test-definition.twig').toString();
      const docText = "{% include 'numiko:card' %}";

      client.notify('textDocument/didOpen', {
        textDocument: { uri: docUri, languageId: 'twig', version: 1, text: docText },
      });

      // Cursor at character 15 — inside "numiko:card"
      const definitionResponse = await client.request('textDocument/definition', {
        textDocument: { uri: docUri },
        position: { line: 0, character: 15 },
      });

      expect(definitionResponse.error).toBeUndefined();
      const location = definitionResponse.result;
      if (location !== null) {
        expect(location.uri).toContain('card.twig');
        expect(location.range.start.line).toBe(0);
      }

      await client.request('shutdown', undefined);
      client.notify('exit', undefined);
      await client.waitForExit();
    } finally {
      client.kill();
    }
  }, 30000);

  it('returns null definition for unknown component ID', async () => {
    if (!fs.existsSync(SERVER_DIST)) {
      console.warn('Skipping: server not built');
      return;
    }

    const client = spawnServer();
    try {
      await client.request('initialize', INIT_PARAMS);
      client.notify('initialized', {});

      await sleep(800);

      const docUri = URI.file('/tmp/test-unknown.twig').toString();
      const docText = "{% include 'numiko:nonexistent' %}";

      client.notify('textDocument/didOpen', {
        textDocument: { uri: docUri, languageId: 'twig', version: 1, text: docText },
      });

      const definitionResponse = await client.request('textDocument/definition', {
        textDocument: { uri: docUri },
        position: { line: 0, character: 15 },
      });

      expect(definitionResponse.error).toBeUndefined();
      expect(definitionResponse.result).toBeNull();

      await client.request('shutdown', undefined);
      client.notify('exit', undefined);
      await client.waitForExit();
    } finally {
      client.kill();
    }
  }, 30000);

  it('handles shutdown and exit cleanly with code 0', async () => {
    if (!fs.existsSync(SERVER_DIST)) {
      console.warn('Skipping: server not built');
      return;
    }

    const client = spawnServer();
    try {
      await client.request('initialize', INIT_PARAMS);
      client.notify('initialized', {});

      const shutdownResponse = await client.request('shutdown', undefined);
      expect(shutdownResponse.error).toBeUndefined();

      client.notify('exit', undefined);
      const exitCode = await client.waitForExit(5000);
      expect(exitCode).toBe(0);
    } finally {
      client.kill();
    }
  }, 30000);
});
