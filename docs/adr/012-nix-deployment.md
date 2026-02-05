# ADR-012: Nix Deployment Architecture

- Status: Accepted
- Date: 2025-12-05

## Context

SmartScraper needs a reproducible build and deployment strategy that:
- Provides consistent development environments
- Builds production artifacts deterministically
- Integrates with NixOS for service deployment
- Manages secrets securely via sops-nix

## Decision

### Flake Structure

```
flake.nix
├── devShells.default     # Development environment
├── packages.default      # Built application
└── nixosModules.default  # NixOS service module
```

### Development Shell

Enter with `nix develop`:

```nix
devShells.default = pkgs.mkShell {
  buildInputs = [
    nodejs_24
    chromium
    typescript
    typescript-language-server
    prettier
  ];
};
```

**Environment:**
- `EXECUTABLE_PATH` set to Nix Chromium path
- `node_modules/.bin` added to PATH
- All tools pinned to flake.lock versions

### Package Build

Build with `nix build`:

```nix
smart-scraper = pkgs.stdenv.mkDerivation {
  pname = "smart-scraper";
  
  buildPhase = "npm run build";
  
  installPhase = ''
    # Copy dist/, node_modules/, package.json
    # Create wrapper with EXECUTABLE_PATH baked in
    makeWrapper ${nodejs}/bin/node $out/bin/smart-scraper \
      --add-flags "$out/lib/smart-scraper/dist/index.js" \
      --set EXECUTABLE_PATH "${chromium}/bin/chromium"
  '';
};
```

**Output structure:**
```
result/
├── bin/
│   └── smart-scraper     # Wrapped executable
└── lib/smart-scraper/
    ├── dist/             # Compiled TypeScript
    ├── node_modules/     # Production dependencies
    └── package.json
```

### NixOS Module

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enable` | bool | `false` | Enable the service |
| `port` | port | `5555` | HTTP listen port |
| `dataDir` | path | `/var/lib/smart-scraper` | Persistent data directory |
| `extensionPaths` | list of path | `[]` | Chrome extension directories |
| `secretsDir` | path | `/run/secrets` | sops-nix secrets directory |
| `openFirewall` | bool | `false` | Open port in firewall |

#### Service User

```nix
users.users.smartscraper = {
  isSystemUser = true;
  group = "smartscraper";
  home = cfg.dataDir;
  createHome = true;
};
```

#### Systemd Service

```nix
systemd.services.smart-scraper = {
  description = "SmartScraper web scraping service";
  wantedBy = [ "multi-user.target" ];
  after = [ "network.target" ];

  environment = {
    PORT = toString cfg.port;
    DATA_DIR = cfg.dataDir;
    EXTENSION_PATHS = lib.concatStringsSep "," cfg.extensionPaths;
    NODE_ENV = "production";
  };

  serviceConfig = {
    Type = "simple";
    User = "smartscraper";
    Group = "smartscraper";
    Restart = "on-failure";
    RestartSec = 5;
    
    # Hardening
    NoNewPrivileges = true;
    ProtectSystem = "strict";
    ProtectHome = true;
    PrivateTmp = true;
    ReadWritePaths = [ cfg.dataDir ];
  };
};
```

### Secrets Management

Secrets are loaded from sops-nix at runtime:

| Secret Path | Environment Variable | Required |
|-------------|---------------------|----------|
| `smart-scraper/api_token` | `API_TOKEN` | Yes |
| `smart-scraper/openrouter_api_key` | `OPENROUTER_API_KEY` | Yes |
| `smart-scraper/twocaptcha_api_key` | `TWOCAPTCHA_API_KEY` | No |
| `smart-scraper/proxy_server` | `PROXY_SERVER` | No |

**ExecStart loads secrets:**
```bash
export API_TOKEN=$(cat /run/secrets/smart-scraper/api_token)
export OPENROUTER_API_KEY=$(cat /run/secrets/smart-scraper/openrouter_api_key)
# ... etc
exec smart-scraper
```

### Data Directory Structure

```
/var/lib/smart-scraper/
├── sites.jsonc           # Site configurations
├── stats.json            # Persistent statistics
└── logs/
    ├── 2025-12-05.jsonl
    ├── 2025-12-04.jsonl
    └── ...
```

---

## Usage

### Development

```bash
# Enter dev shell
nix develop

# Install dependencies
npm install

# Run in dev mode
npm run dev

# Build
npm run build
```

### Build Package

```bash
# Build (first time will fail with hash mismatch - copy correct hash)
nix build

# Run built package
./result/bin/smart-scraper
```

### NixOS Deployment

**flake.nix (host):**
```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    smart-scraper.url = "github:user/smartScraper";  # or path:
    sops-nix.url = "github:Mic92/sops-nix";
  };

  outputs = { self, nixpkgs, smart-scraper, sops-nix, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      modules = [
        sops-nix.nixosModules.sops
        smart-scraper.nixosModules.default
        ./configuration.nix
      ];
    };
  };
}
```

**configuration.nix:**
```nix
{ config, pkgs, ... }:
{
  # sops-nix secrets
  sops.defaultSopsFile = ./secrets.yaml;
  sops.age.keyFile = "/var/lib/sops-nix/key.txt";
  
  sops.secrets."smart-scraper/api_token" = {
    owner = "smartscraper";
  };
  sops.secrets."smart-scraper/openrouter_api_key" = {
    owner = "smartscraper";
  };
  sops.secrets."smart-scraper/twocaptcha_api_key" = {
    owner = "smartscraper";
  };
  sops.secrets."smart-scraper/proxy_server" = {
    owner = "smartscraper";
  };

  # SmartScraper service
  services.smart-scraper = {
    enable = true;
    port = 5555;
    extensionPaths = [
      "${pkgs.callPackage ./extensions/ublock.nix {}}"
      "${pkgs.callPackage ./extensions/bypass-paywalls.nix {}}"
    ];
    openFirewall = true;
  };
}
```

**secrets.yaml (encrypted with sops):**
```yaml
smart-scraper:
  api_token: ENC[AES256_GCM,data:...,tag:...]
  openrouter_api_key: ENC[AES256_GCM,data:...,tag:...]
  twocaptcha_api_key: ENC[AES256_GCM,data:...,tag:...]
  proxy_server: ENC[AES256_GCM,data:...,tag:...]
```

---

## Consequences

### Benefits

- **Reproducible builds**: Exact same dependencies everywhere via flake.lock
- **Isolated development**: DevShell doesn't pollute system
- **Declarative deployment**: NixOS module makes service configuration explicit
- **Secure secrets**: sops-nix keeps secrets encrypted at rest, decrypted only at runtime
- **Systemd hardening**: Service runs with minimal privileges

### Trade-offs

- **npm deps hash updates**: Must update `npmDeps.hash` when dependencies change
- **Extension packaging**: Chrome extensions need separate Nix packaging
- **Chromium size**: Nix Chromium is large (~500MB in store)

### Implementation Requirements

- Update `npmDeps.hash` after modifying `package-lock.json`
- Create Nix derivations for Chrome extensions
- Configure sops-nix with age or GPG keys
- Ensure `/var/lib/smart-scraper` is backed up
