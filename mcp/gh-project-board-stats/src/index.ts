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

import "dotenv/config";
import readline from "node:readline";
import Anthropic from "@anthropic-ai/sdk";

import { connectMCP } from "./tools/mcpClient";
import { routeIntent } from "./agent/routeIntent";
import { runTool } from "./tools/runTool";

async function main() {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("Missing ANTHROPIC_API_KEY environment variable");
    }
    const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
    });

    const client = await connectMCP();

    console.log("GitHub Assistant is ready!");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.setPrompt("ASK > ");
    rl.prompt();

    rl.on("line", async (input) => {
        const question = input.trim();
        if (!question) return rl.prompt();

        try {
            console.log("Understanding request...");

            const intent = await routeIntent(anthropic, question);
            console.log("Intent resolved:", intent);
            const result = await runTool(client, intent);

            if (!Array.isArray(result) || result.length === 0) {
                console.log("\nNo releases found for this week's iteration.\n");
            } else {
                console.log(`\nFound ${result.length} release(s):\n`);

                result.forEach((release: any, index: number) => {

                    console.log(
                        `${index + 1}. ${release.content.title}`
                    );

                    console.log(
                        `URL: ${release.content.html_url}`
                    );

                });
            }
        } catch (err) {
            console.error(err);
        }

        rl.prompt();
    });
}

main().catch(console.error);