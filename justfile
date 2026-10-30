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

# Clean up port 8095 and start server with tsx
dev *ARGS:
    bunx kill-port 8095
    pnpm dev -- {{ARGS}}

# Run the reproducible acceptance demonstration
demo:
    pnpm demo

# Run the trails-logos CLI
cli *ARGS:
    pnpm trails-logos {{ARGS}}
