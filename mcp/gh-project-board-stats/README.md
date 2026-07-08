# GitHub MCP Demo Assistant

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


## Project Structure

```
src
|
├── agent
│   └── routeIntent.ts
│
├── services
│   ├── iteration.service.ts
│   ├── projectField.service.ts
│   ├── projectItem.service.ts
│   └── release.service.ts
│
├── tools
│   ├── mcpClient.ts
│   └── runTool.ts
│
└── index.ts
```


# Setup

## 1. Clone the repository

```bash
git clone <repository-url>

cd github-release-assistant
```


## 2. Install dependencies

```bash
npm install
```


## 3. Configure environment variables

Create a `.env` file:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key

GITHUB_PERSONAL_ACCESS_TOKEN=your_github_token

USERNAME=your_github_username

PROJECT_ID=your_project_number
```


## 4. GitHub Token Requirements

The GitHub token requires access to GitHub Projects.

Required permissions:

```
read:project
```


# Running the Application

Start the assistant:

```bash
npx tsx src/index.ts
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
Issue: #7
URL: https://github.com/...
```
