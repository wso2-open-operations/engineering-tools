# GitHub Project Board Stats MCP

An AI-powered GitHub Project assistant that uses the **Model Context Protocol (MCP)** and **Claude AI** to retrieve and filter GitHub Project releases based on user queries.

The assistant understands natural language questions such as:

> "What are releases this week?"

and identifies the relevant GitHub Project items by checking their iteration and release information.

## Features

- Natural language query understanding using Claude AI
- GitHub Projects v2 integration through GitHub MCP Server
- Dynamic GitHub Project field discovery
- Retrieve project items with custom field values
- Iteration-based filtering
- Release identification
- Function/team filtering support for organization projects


## Architecture

```
User Question
      |
      v
Claude Intent Router
      |
      v
GitHub MCP Client
      |
      v
GitHub MCP Server
      |
      v
GitHub Projects API
      |
      v
Filtering Services
      |
      v
Release Results
```

## Technologies

- TypeScript
- Node.js
- Anthropic Claude API
- GitHub MCP Server
- GitHub Projects v2
- Model Context Protocol (MCP)


# Running the Application

Start the assistant:

Build Docker Image

```bash
docker build -t gh-project-board-stats .
```

Run Container 

```bash
docker run --env-file .env gh-project-board-stats
```

Example:

```
GitHub Assistant

ASK > What are releases this week?
```

Output:

```
Found 1 release(s):

1. Employee onboarding API
URL: https://github.com/...
```
