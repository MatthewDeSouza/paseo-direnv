{
  description = "Paseo plugin that loads each agent's direnv environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      fs = lib.fileset;

      # The files Paseo compiles. Tests and dev tooling stay out of the store path.
      pluginFiles = fs.unions [
        ./paseo-plugin.json
        ./index.server.ts
        ./index.client.tsx
        ./LICENSE
        ./client
        ./server
        ./shared
      ];
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.stdenvNoCC.mkDerivation {
          pname = "paseo-direnv";
          version = "0.1.0";
          src = fs.toSource {
            root = ./.;
            fileset = pluginFiles;
          };
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            cp -r . $out
            runHook postInstall
          '';
          meta.license = lib.licenses.mit;
        };
      });

      checks = forAllSystems (pkgs: {
        typecheck-and-test = pkgs.stdenv.mkDerivation {
          name = "paseo-direnv-check";
          src = fs.toSource {
            root = ./.;
            fileset = fs.unions [
              pluginFiles
              ./package.json
              ./package-lock.json
              ./tsconfig.base.json
              ./tsconfig.server.json
              ./tsconfig.client.json
              ./test
            ];
          };
          nativeBuildInputs = [
            pkgs.nodejs_22
            pkgs.importNpmLock.npmConfigHook
          ];
          npmDeps = pkgs.importNpmLock { npmRoot = ./.; };
          npmFlags = [ "--ignore-scripts" ];
          buildPhase = ''
            runHook preBuild
            npm run typecheck
            npm test
            runHook postBuild
          '';
          installPhase = "touch $out";
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.typescript
            pkgs.direnv
          ];
        };
      });
    };
}
