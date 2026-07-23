BINARY := scraper

# Load .env (if present) into the environment for targets that need
# credentials. Uses shell `source` — not make `include` — so quoted values
# like DB_HOST="localhost" are unquoted correctly. No-op when .env is absent
# (e.g. CI or Choreo, where real env vars are already set).
LOAD_ENV = set -a; [ -f .env ] && . ./.env; set +a;

.PHONY: all setup fmt vet test test-live test-db build clean run

all: build

# Install the shared git hooks (run once after cloning).
setup:
	git -C "$(shell git rev-parse --show-toplevel)" config core.hooksPath .githooks

fmt:
	go fmt ./...

vet:
	go vet ./...

# Credential-free tests: HTML parsers (golden fixtures) + API client (mock server).
test: vet
	go test -race ./...

# Live test against today's real github.com markup (no DB, no PAT).
test-live:
	RUN_LIVE=1 go test -race ./internal/github/ -run TestLiveScrape -v

# Store integration test against a MySQL instance with migrations
# 000001_add_package_snapshot_tables.sql and 000002_add_track_packages_flag.sql
# applied (ActiveTrackedRepos queries the track_packages column from 000002).
# DB_* come from .env (auto-loaded).
test-db:
	$(LOAD_ENV) RUN_DB=1 go test -race ./internal/store/ -run TestIntegrationRoundTrip -v

build: test
	go build -o $(BINARY) ./cmd/scraper

clean:
	rm -f $(BINARY)

# One full run — DB_* and GITHUB_PAT come from .env (auto-loaded).
run: fmt
	$(LOAD_ENV) go run ./cmd/scraper
