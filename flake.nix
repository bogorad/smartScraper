{
  description = "SmartScraper - Intelligent web scraping service";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
    sops-nix = {
      url = "github:Mic92/sops-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      sops-nix,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        nodejs = pkgs.nodejs_24;
        chromium = pkgs.chromium;

        # Build the application
        smart-scraper = pkgs.buildNpmPackage {
          pname = "smart-scraper";
          version = "0.1.0";

          src = ./.;

          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

          nativeBuildInputs = [
            pkgs.makeWrapper
          ];

          buildPhase = ''
            runHook preBuild
            npm run build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p $out/lib/smart-scraper
            cp -r dist $out/lib/smart-scraper/
            cp -r node_modules $out/lib/smart-scraper/
            cp package.json $out/lib/smart-scraper/

            mkdir -p $out/bin
            makeWrapper ${nodejs}/bin/node $out/bin/smart-scraper \
              --add-flags "$out/lib/smart-scraper/dist/index.js" \
              --set EXECUTABLE_PATH "${chromium}/bin/chromium" \
              --prefix PATH : "${pkgs.lib.makeBinPath [ chromium ]}"

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Intelligent web scraping service with LLM-assisted content extraction";
            license = licenses.mit;
            platforms = platforms.linux;
          };
        };

      in
      {
        packages = {
          default = smart-scraper;
          inherit smart-scraper;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            nodejs
            chromium

            # Development tools
            pkgs.typescript
            pkgs.nodePackages.typescript-language-server
            pkgs.nodePackages.prettier

            # Secrets management
            pkgs.sops
            pkgs.jq
          ];

          shell = "${pkgs.zsh}/bin/zsh";

          shellHook = ''
            export EXECUTABLE_PATH="${chromium}/bin/chromium"
            export PATH="$PWD/node_modules/.bin:$PATH"

            # Load .env file if present
            if [ -f .env ]; then
              echo "Loading .env file..."
              set -a
              source .env
              set +a
              echo ".env loaded."
            fi

            # Load secrets from sops-encrypted secrets.yaml
            if [ -f secrets.yaml ]; then
              echo "Loading secrets from secrets.yaml..."
              SECRETS_JSON=$(sops decrypt secrets.yaml --output-type=json 2>/dev/null) && {
                export API_TOKEN=$(echo "$SECRETS_JSON" | jq -r '.smart_scraper // empty')
                export OPENROUTER_API_KEY=$(echo "$SECRETS_JSON" | jq -r '.openrouter // empty')
                export TWOCAPTCHA_API_KEY=$(echo "$SECRETS_JSON" | jq -r '.twocaptcha // empty')
                echo "Secrets loaded."
              } || echo "Warning: Failed to decrypt secrets.yaml (check sops config)"
            else
              echo "Warning: secrets.yaml not found, API keys not set"
            fi

            echo ""
            echo "SmartScraper Development Shell"
            echo "==============================="
            echo "Node.js:  $(node --version)"
            echo "npm:      $(npm --version)"
            echo "Chromium: ${chromium.version}"
            echo ""
            echo "EXECUTABLE_PATH=$EXECUTABLE_PATH"
            [ -n "$API_TOKEN" ] && echo "API_TOKEN=<set>" || echo "API_TOKEN=<not set>"
            [ -n "$OPENROUTER_API_KEY" ] && echo "OPENROUTER_API_KEY=<set>" || echo "OPENROUTER_API_KEY=<not set>"
            [ -n "$TWOCAPTCHA_API_KEY" ] && echo "TWOCAPTCHA_API_KEY=<set>" || echo "TWOCAPTCHA_API_KEY=<not set>"
            [ -n "$EXTENSION_PATHS" ] && echo "EXTENSION_PATHS=<set>" || echo "EXTENSION_PATHS=<not set>"
            echo ""
            echo "Commands:"
            echo "  npm install    - Install dependencies"
            echo "  npm run build  - Build TypeScript"
            echo "  npm run dev    - Run in development mode"
            echo "  npm start      - Run production build"
            echo ""
            echo ""
          '';
        };
      }
    )
    // {
      # NixOS module
      nixosModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.services.smart-scraper;
          pkg = self.packages.${pkgs.system}.smart-scraper;
        in
        {
          imports = [ sops-nix.nixosModules.sops ];

          options.services.smart-scraper = {
            enable = lib.mkEnableOption "SmartScraper web scraping service";

            port = lib.mkOption {
              type = lib.types.port;
              default = 5555;
              description = "Port to listen on";
            };

            dataDir = lib.mkOption {
              type = lib.types.path;
              default = "/var/lib/smart-scraper";
              description = "Directory for persistent data (sites.jsonc, stats.json, logs/)";
            };

            extensionPaths = lib.mkOption {
              type = lib.types.listOf lib.types.path;
              default = [ ];
              description = "Paths to unpacked Chrome extensions";
            };

            sopsSecretsFile = lib.mkOption {
              type = lib.types.path;
              default = ./secrets.yaml;
              description = "Path to sops-encrypted secrets.yaml file";
            };

            envFile = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = "Path to .env file for additional environment variables (e.g., EXTENSION_PATHS)";
            };

            openFirewall = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Open firewall port for the service";
            };
          };

          config = lib.mkIf cfg.enable {
            sops.secrets = {
              "api_keys/smart_scraper" = {
                sopsFile = cfg.sopsSecretsFile;
                owner = "smartscraper";
                group = "smartscraper";
              };
              "api_keys/openrouter" = {
                sopsFile = cfg.sopsSecretsFile;
                owner = "smartscraper";
                group = "smartscraper";
              };
              "api_keys/twocaptcha" = {
                sopsFile = cfg.sopsSecretsFile;
                owner = "smartscraper";
                group = "smartscraper";
              };
            };

            users.users.smartscraper = {
              isSystemUser = true;
              group = "smartscraper";
              home = cfg.dataDir;
              createHome = true;
            };

            users.groups.smartscraper = { };

            systemd.services.smart-scraper = {
              description = "SmartScraper web scraping service";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];

              environment = {
                PORT = toString cfg.port;
                DATA_DIR = cfg.dataDir;
                NODE_ENV = "production";
              };

              serviceConfig = {
                Type = "simple";
                User = "smartscraper";
                Group = "smartscraper";
                WorkingDirectory = cfg.dataDir;

                ExecStartPre = pkgs.writeShellScript "smart-scraper-pre" ''
                  mkdir -p ${cfg.dataDir}/logs
                '';

                ExecStart = pkgs.writeShellScript "smart-scraper-start" ''
                  # Load .env file if configured
                  ${lib.optionalString (cfg.envFile != null) ''
                    if [ -f "${cfg.envFile}" ]; then
                      set -a
                      source "${cfg.envFile}"
                      set +a
                    fi
                  ''}

                  # Load secrets from sops-nix
                  export API_TOKEN=$(cat ${config.sops.secrets."api_keys/smart_scraper".path} 2>/dev/null || echo "")
                  export OPENROUTER_API_KEY=$(cat ${
                    config.sops.secrets."api_keys/openrouter".path
                  } 2>/dev/null || echo "")
                  export TWOCAPTCHA_API_KEY=$(cat ${
                    config.sops.secrets."api_keys/twocaptcha".path
                  } 2>/dev/null || echo "")

                  exec ${pkg}/bin/smart-scraper
                '';

                Restart = "on-failure";
                RestartSec = 5;

                # Hardening
                NoNewPrivileges = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                PrivateTmp = true;
                ReadWritePaths = [ cfg.dataDir ];

                # Chromium needs these
                ProtectKernelTunables = false;
                MemoryDenyWriteExecute = false;
              };
            };

            networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
          };
        };
    };
}
