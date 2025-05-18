# flake.nix

{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    nix-vscode-extensions.url = "github:nix-community/nix-vscode-extensions";
    nix-vscode-extensions.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      nix-vscode-extensions,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        extensions = nix-vscode-extensions.extensions.${system};
        # I've added nodejs_22 and nodePackages here for convenience
        inherit (pkgs)
          vscode-with-extensions
          vscodium
          zsh
          chromium
          nodejs_22
          nodePackages
          ;

        codium-with-extensions = vscode-with-extensions.override {
          vscode = vscodium;
          vscodeExtensions = with extensions; [
            vscode-marketplace.rooveterinaryinc.roo-cline
            vscode-marketplace.catppuccin.catppuccin-vsc
            vscode-marketplace.golang.go
            vscode-marketplace.jnoortheen.nix-ide
            # vscode-marketplace.augment.vscode-augment
            vscode-marketplace.google.geminicodeassist
            open-vsx-release.rust-lang.rust-analyzer
          ];
        };
      in
      {
        packages.default = codium-with-extensions;

        devShells.default = pkgs.mkShell {
          buildInputs = [
            # Add the custom VSCodium package
            self.packages.${system}.default

            # System tools
            zsh
            chromium

            # --- ADDED PACKAGES START ---
            # Node.js / TypeScript development tools
            nodejs_22
            nodePackages.pnpm
            nodePackages.typescript
            # --- ADDED PACKAGES END ---
          ];
          shellHook = ''
            printf "========================== VS-Codium with extensions: ==========================\n"
            codium --list-extensions
            printf "\n================================= Node tools: ==================================\n"
            node --version
            pnpm --version
            tsc --version
            printf "================================================================================\n"
          '';
        };
      }
    );
}
