# ADR-018: Minimal Puppeteer WebSocket Server (Replace browserless)

- Status: Proposed
- Date: 2026-02-06

## Context

The current infrastructure runs **browserless** as a separate service to provide a Puppeteer-compatible WebSocket endpoint. This endpoint is consumed by **rsshub**, which connects via:

```typescript
// rsshub's lib/utils/puppeteer.ts
const endpointURL = new URL(config.puppeteerWSEndpoint); // e.g., ws://browserless:3000
endpointURL.searchParams.set('launch', JSON.stringify(options));
endpointURL.searchParams.set('stealth', 'true');
browser = await puppeteer.connect({ browserWSEndpoint: endpointURL.toString() });
```

### Problems with browserless

| Issue | Impact |
|-------|--------|
| **Large footprint** | ~500MB+ Docker image with many unused features |
| **Maintenance burden** | External project to track, update, and debug |
| **Resource overhead** | Runs features (screenshots, PDFs, REST API) that rsshub doesn't use |
| **Separate service** | Additional container/process to manage and monitor |

### What rsshub Actually Needs

rsshub only uses the **WebSocket connection endpoint** that:

1. Accepts `?launch=` query param with Chrome launch options
2. Launches a fresh Chrome instance with those options
3. Proxies Chrome's CDP (Chrome DevTools Protocol) WebSocket
4. Cleans up when the client disconnects

This is a ~50-100 line implementation.

## Decision

Replace browserless with a **minimal Puppeteer WebSocket server** that implements only the subset rsshub requires.

### Architecture

```
┌─────────────┐         ┌─────────────────────┐         ┌──────────────┐
│   rsshub    │───WS───▶│  puppeteer-server   │───CDP──▶│    Chrome    │
│             │◀──WS────│     (port 3000)     │◀──CDP───│   instance   │
└─────────────┘         └─────────────────────┘         └──────────────┘

┌─────────────┐         ┌─────────────────────┐         ┌──────────────┐
│ SmartScraper│─local──▶│  PuppeteerAdapter   │─local──▶│    Chrome    │
│             │         │  (puppeteer.launch) │         │   instance   │
└─────────────┘         └─────────────────────┘         └──────────────┘
```

- **puppeteer-server**: Standalone service exposing WebSocket on port 3000
- **SmartScraper**: Continues using local `puppeteer.launch()` (unchanged)
- Both share the same Chromium binary (via Nix)

### Implementation

#### Standalone Service (`puppeteer-server/index.ts`)

```typescript
import puppeteer from 'puppeteer-core';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const EXECUTABLE_PATH = process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium';
const PORT = parseInt(process.env.PORT || '3000', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '30000', 10);

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  
  // Parse browserless-compatible query params
  const launchOptions = JSON.parse(url.searchParams.get('launch') || '{}');
  
  // Create isolated temp profile
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-'));
  
  let browser;
  let chromeWs: WebSocket | null = null;
  
  const cleanup = async () => {
    try { chromeWs?.close(); } catch {}
    try { await browser?.close(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  };
  
  try {
    // Merge client options with required args
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(launchOptions.args || []),
    ];
    
    browser = await puppeteer.launch({
      executablePath: EXECUTABLE_PATH,
      headless: true,
      userDataDir,
      args,
      timeout: TIMEOUT_MS,
    });
    
    // Connect to Chrome's CDP WebSocket
    const wsEndpoint = browser.wsEndpoint();
    chromeWs = new WebSocket(wsEndpoint);
    
    // Bidirectional proxy
    chromeWs.on('open', () => {
      clientWs.on('message', (data) => chromeWs?.send(data));
      chromeWs.on('message', (data) => clientWs.send(data));
    });
    
    chromeWs.on('close', () => clientWs.close());
    chromeWs.on('error', () => clientWs.close());
    
    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);
    
    // Safety timeout
    setTimeout(cleanup, TIMEOUT_MS);
    
  } catch (error) {
    console.error('[puppeteer-server] Launch failed:', error);
    clientWs.close();
    await cleanup();
  }
});

server.listen(PORT, () => {
  console.log(`[puppeteer-server] Listening on port ${PORT}`);
});
```

#### NixOS Module

```nix
# puppeteer-server NixOS module
{ config, lib, pkgs, ... }:

let
  cfg = config.services.puppeteer-server;
in {
  options.services.puppeteer-server = {
    enable = lib.mkEnableOption "Puppeteer WebSocket server";
    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
    };
    timeoutMs = lib.mkOption {
      type = lib.types.int;
      default = 30000;
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.puppeteer-server = {
      description = "Puppeteer WebSocket Server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      
      environment = {
        PORT = toString cfg.port;
        TIMEOUT_MS = toString cfg.timeoutMs;
        EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
      };
      
      serviceConfig = {
        Type = "simple";
        DynamicUser = true;
        Restart = "on-failure";
        RestartSec = 5;
        
        # Hardening
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
      };
    };
  };
}
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | WebSocket listen port |
| `EXECUTABLE_PATH` | `/usr/lib/chromium/chromium` | Path to Chromium binary |
| `TIMEOUT_MS` | `30000` | Max session duration (safety limit) |

### rsshub Configuration

rsshub continues to use the same environment variable, just pointing to the new service:

```env
# Before (browserless)
PUPPETEER_WS_ENDPOINT=ws://browserless:3000

# After (puppeteer-server)
PUPPETEER_WS_ENDPOINT=ws://puppeteer-server:3000
```

No changes required to rsshub code.

## Consequences

### Benefits

| Benefit | Description |
|---------|-------------|
| **Minimal footprint** | ~50-100 lines vs entire browserless codebase |
| **Lower resource usage** | No unused features running |
| **Full control** | We own the code, can debug and extend easily |
| **Same Chromium** | Shares Nix-managed Chromium with SmartScraper |
| **Simple deployment** | Single TypeScript file, trivial NixOS module |
| **Drop-in replacement** | rsshub config unchanged except hostname |

### Trade-offs

| Trade-off | Mitigation |
|-----------|------------|
| **No browserless features** | rsshub doesn't use them (screenshots, PDFs, REST API) |
| **Must maintain ourselves** | Code is minimal (~100 lines), low maintenance burden |
| **No stealth mode** | Can add `puppeteer-extra-plugin-stealth` if needed |

### Implementation Requirements

1. Create `puppeteer-server/` directory with TypeScript implementation
2. Add NixOS module for service deployment
3. Update infrastructure to deploy puppeteer-server instead of browserless
4. Update rsshub's `PUPPETEER_WS_ENDPOINT` to point to new service
5. Remove browserless from infrastructure

### Migration Path

1. Deploy puppeteer-server alongside browserless (different port)
2. Test rsshub against puppeteer-server
3. Switch rsshub to puppeteer-server
4. Decommission browserless

## Related

- **ADR-001**: Puppeteer Browser Configuration (SmartScraper's local browser usage)
- **ADR-012**: Nix Deployment Architecture (NixOS module patterns)
