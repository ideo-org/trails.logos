set shell := ["pwsh.exe", "-NoLogo", "-Command"]

default:
    just --list

# Install all workspace dependencies
install:
    pnpm install

# Run strict TypeScript checks across all workspace packages
typecheck:
    pnpm typecheck

# Run unit and integration tests (TypeScript + Rust contract)
test:
    pnpm test
    cd lez; cargo test

# Run Rust contract tests
test-contract:
    cd lez; cargo test

# Build all workspace packages
build:
    pnpm build

# Run the reproducible acceptance demonstration
demo:
    pnpm demo

# Free port 8095
kill-dev:
    bunx kill-port 8095

# Kill existing server on port 8095 and start fresh
restart-dev *ARGS:
    bunx kill-port 8095
    pnpm dev -- {{ARGS}}

# Launch the trails.logos REST API server (port 8095)
dev *ARGS:
    pnpm dev -- {{ARGS}}

# Run the trails-logos CLI
cli *ARGS:
    pnpm trails-logos {{ARGS}}
