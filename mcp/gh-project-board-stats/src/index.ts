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