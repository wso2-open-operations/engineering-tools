// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";


export async function connectMCP() {
    const client = new Client({
        name: "github-release-assistant",
        version: "1.0.0"
    });

    const token =
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN ??
        process.env.GITHUB_TOKEN;

    if (!token) {
        throw new Error("Missing GitHub token");
    }

    const transport = new StdioClientTransport({
        command: process.env.MCP_SERVER_PATH ?? "./github-mcp-server",
        args: [
            "stdio",
            "--toolsets", "repos,issues,projects"
        ],
        env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: token,
            PATH: process.env.PATH ?? "",
        }
    });

    const CONNECT_TIMEOUT_MS = 10_000;
    await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(
                    new Error("MCP server connection timed out")
                ),
                CONNECT_TIMEOUT_MS
            )
        ),
    ]);

    const response = await client.listTools();
    const toolNames = response.tools.map((t: any) => t.name);

    return client;
}