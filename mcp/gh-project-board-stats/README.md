# GitHub Project Board Stats API

This service exposes a REST API for querying GitHub Project Boards through an MCP-enabled assistant. It accepts natural-language questions, resolves the target board, and returns structured release or epic information from GitHub Projects v2.

## What the service does

The API can:

- understand project-board questions written in plain English
- resolve or prompt for the correct GitHub Project board
- return releases or epics for a requested iteration window
- filter results by function/team and execution status
- search for epics or features by name
- remember the user’s active board and saved boards

Typical questions include:

- "What releases are planned for next week?"
- "Show me the epics for the Engineering team"
- "What is done in the IAM board?"

## Architecture

The service uses a small middleware stack:

1. Express receives the request.
2. Claude routes the incoming question into a structured intent.
3. The GitHub MCP server is used to query project boards and items.
4. The service filters and formats the results.
5. MySQL stores user and session state such as the active board and remembered boards.

```text
Client Request
  -> Express API
  -> Anthropic intent routing
  -> GitHub MCP server
  -> Project filtering and formatting
  -> JSON response
```

## API endpoints

### Health check

GET /health

Returns:

```json
{ "status": "UP" }
```

### Query projects

POST /query

Request body:

```json
{
  "question": "What releases are planned for next week?"
}
```

Required header:

```text
x-jwt-assertion: <JWT>
```

The service validates the JWT and requires a valid authenticated identity before processing the request.

Supported response types include:

- board_selection
- board_acknowledgment
- release_list
- epic_list
- epic_search_results
- unsupported_query

## Authentication and identity

The service expects a signed JWT supplied through the x-jwt-assertion header. Authentication is verified against the configured JWKS endpoint, and the user’s GitHub identity and email are used to persist session state.

The current implementation supports:

- Choreo-based JWT validation by default
- Asgardeo-based validation when AUTH_ISSUER=asgardeo

## Environment variables

Required or commonly used variables:

```text
ANTHROPIC_API_KEY
GITHUB_PERSONAL_ACCESS_TOKEN (or GITHUB_TOKEN)
GITHUB_OWNER
DB_HOST
DB_USER
DB_PASSWORD
DB_NAME
RUN_MIGRATIONS
AUTH_ISSUER=choreo|asgardeo
CHOREO_JWKS_URI
ASGARDEO_JWKS_URI
MCP_SERVER_PATH=/usr/local/bin/github-mcp-server
PORT
```

`RUN_MIGRATIONS` defaults to off. Set it to `true` on first boot or after a schema change, not as a standing value on every deploy.

`PORT` defaults to `8080`; set it if that port is already in use.

`GITHUB_PERSONAL_ACCESS_TOKEN` (or `GITHUB_TOKEN` as a fallback) is required at startup — the service fails to boot without one, since it's passed to the local GitHub MCP subprocess for all board/item reads.

## Build and run locally

Install dependencies:

```bash
npm install
```

Build the TypeScript service:

```bash
npm run build
```

Start the service:

```bash
npm start
```

## Docker build and run

```bash
docker build -t gh-project-board-stats .
docker run --name stats-service --rm -p 8080:8080 --env-file .env gh-project-board-stats
```

## Notes

- The service is designed to run behind an API gateway such as Choreo, where the JWT assertion header is injected automatically.
- If no board is selected, the service may ask the user to choose one before proceeding.
- Saved board preferences are stored per user and can be reused for future queries.
- "Iteration window" filtering (this/next/previous week) applies to boards configured as iteration-based. Boards configured as flat kanban boards instead treat a configured status column (e.g. "Done") as the release signal.
