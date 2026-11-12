# List the recipes.
default:
    @just --list

# Install the SDK types and test dependencies from package-lock.json.
setup:
    npm ci --ignore-scripts

# Type-check the server and client projects.
typecheck:
    npm run typecheck

# Run the unit tests.
test:
    npm test

# Type-check and test in the Nix sandbox, as CI does.
check:
    nix flake check --print-build-logs

# Build the plugin directory into ./result.
build:
    nix build --print-build-logs

# Install the built plugin into the local Paseo daemon.
install: build
    paseo plugin install "$(readlink -f result)"
