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
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { connectMCP } from "./tools/mcpClient";
import { routeIntent } from "./agent/routeIntent";
import { runTool } from "./tools/runTool";
import { dbPool, initializeDatabase } from "./database/mysql";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    });
    return Promise.race([
        promise.finally(() => clearTimeout(timeout)),
        timeoutPromise
    ]);
}

function getMcpResponseText(result: any): string {
    if (!result || !result.content || !Array.isArray(result.content)) {
        return "";
    }
    return result.content
        .filter((c: any) => c && c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
}

async function main() {
    await initializeDatabase();

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const client = await connectMCP();
    const app = express();

    app.use(express.json({ limit: "10kb" }));

    app.get("/health", (_req, res) => {
        res.json({
            status: "UP"
        });
    });

    app.post("/query", async (req, res) => {
        try {
            const question = req.body?.question;
            const userId = req.headers["x-user-id"] ? String(req.headers["x-user-id"]) : "default_user";
            const ownerGroup = process.env.GITHUB_OWNER ?? "org-owner";

            if (typeof question !== "string" || !question.trim()) {
                return res.status(400).json({ error: "Missing or invalid question" });
            }

            const [sessionRows]: any = await dbPool.execute("SELECT * FROM user_session_state WHERE user_id = ?", [userId]);
            const [prefRows]: any = await dbPool.execute(
                "SELECT project_id, board_name FROM user_project_preferences WHERE user_id = ? AND is_remembered = 1",
                [userId]
            );

            const session = sessionRows[0] || null;
            const savedPreference = prefRows[0] || null;

            if (session && session.current_state === 'AWAITING_REMEMBER_CONFIRMATION') {
                const isYes = /yes|yep|sure|yeah/i.test(question);
                let activeId = savedPreference ? savedPreference.project_id : null;

                if (isYes && session.pending_board_name) {
                    const discovery = await withTimeout(
                        client.callTool({ name: "projects_list", arguments: { method: "list_projects", owner: ownerGroup } }),
                        30000
                    );
                    const raw = JSON.parse(getMcpResponseText(discovery));
                    const project = raw.projects?.find((p: any) => p.title.toLowerCase().includes(session.pending_board_name.toLowerCase()));

                    if (project) {
                        await dbPool.execute(
                            "INSERT INTO user_project_preferences (user_id, project_id, organization_name, board_name, is_remembered) VALUES (?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE project_id=?, board_name=?, is_remembered=1",
                            [userId, project.number, ownerGroup, project.title, project.number, project.title]
                        );
                        activeId = project.number;
                    }
                } else if (session.pending_board_name) {
                    activeId = await getProjectIdByName(client, ownerGroup, session.pending_board_name);
                }

                const intentArgs = { args: { iteration: session.pending_iteration || 'this_week', function: session.pending_function } };

                const releases = await withTimeout(
                    runTool(client, intentArgs, { owner: ownerGroup, projectNumber: activeId }),
                    30000
                );

                const releaseList = releases.map((r: any) => `• ${r.content?.title ?? "Untitled Issue"}`).join("\n");

                const saveMessage = isYes
                    ? "Great. I'll remember this board for your future queries!"
                    : "Got it. I won't remember this setting.";

                const responseMsg = `${saveMessage} Let me check the current iteration.\n\nAccording to the current iteration, the planned releases for this week are:\n${releaseList || "• No current releases found."}`;

                await dbPool.execute("DELETE FROM user_session_state WHERE user_id = ?", [userId]);
                return res.json({ message: responseMsg });
            }

            if (session && session.current_state === 'AWAITING_BOARD_SELECTION') {
                const chosenBoard = question.trim();

                await dbPool.execute(
                    "UPDATE user_session_state SET current_state = 'AWAITING_REMEMBER_CONFIRMATION', pending_board_name = ? WHERE user_id = ?",
                    [chosenBoard, userId]
                );

                return res.json({
                    message: `Got it. I'll use the ${chosenBoard}. Should I remember this board for your future release queries?`
                });
            }

            const activeBoardName = savedPreference ? savedPreference.board_name : null;
            const intent = await routeIntent(anthropic, question, activeBoardName);

            if (intent.extractedBoardName) {
                const discovery = await withTimeout(
                    client.callTool({ name: "projects_list", arguments: { method: "list_projects", owner: ownerGroup } }),
                    30000
                );
                const raw = JSON.parse(getMcpResponseText(discovery));
                const matchedProject = raw.projects?.find((p: any) =>
                    p.title.toLowerCase().includes(intent.extractedBoardName.toLowerCase())
                );

                if (matchedProject) {
                    await dbPool.execute(
                        "INSERT INTO user_project_preferences (user_id, project_id, organization_name, board_name, is_remembered) VALUES (?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE project_id=?, board_name=?, is_remembered=1",
                        [userId, matchedProject.number, ownerGroup, matchedProject.title, matchedProject.number, matchedProject.title]
                    );

                    const releases = await withTimeout(
                        runTool(client, intent, { owner: ownerGroup, projectNumber: matchedProject.number }),
                        30000
                    );
                    const releaseList = releases.map((r: any) => `• ${r.content?.title ?? "Untitled Issue"}`).join("\n");

                    return res.json({
                        message: `Got it. I'll use the ${matchedProject.title}.\n\nAccording to the current iteration, the planned releases for this week are:\n${releaseList || "• No current releases found."}`
                    });
                } else {
                    return res.json({
                        message: `I could not find a project board matching "${intent.extractedBoardName}". Please select an active board.`
                    });
                }
            }

            if (intent.status === "REQUIRES_BOARD_SELECTION") {
                const discovery = await withTimeout(
                    client.callTool({ name: "projects_list", arguments: { owner: ownerGroup } }),
                    30000
                );

                const discoveryText = getMcpResponseText(discovery);

                if (!discoveryText.trim().startsWith('{')) {
                    console.error("GitHub MCP Server rejected request. Diagnostic details:", discoveryText);
                    return res.status(502).json({
                        error: "Failed to read projects from GitHub.",
                        details: discoveryText
                    });
                }

                const raw = JSON.parse(discoveryText);
                const boardsList = raw.projects?.map((p: any) => p.title) ?? [];

                await dbPool.execute(
                    "INSERT INTO user_session_state (user_id, current_state, pending_iteration, pending_function) VALUES (?, 'AWAITING_BOARD_SELECTION', ?, ?) ON DUPLICATE KEY UPDATE current_state='AWAITING_BOARD_SELECTION', pending_iteration=?, pending_function=?",
                    [userId, intent.args.iteration, intent.args.function, intent.args.iteration, intent.args.function]
                );

                if (boardsList.length > 1) {
                    const boardOptions = boardsList.map((b: string) => `• ${b}`).join("\n");
                    return res.json({
                        message: `I found multiple project boards associated with you:\n${boardOptions}\n\nWhich one would you like me to check?`
                    });
                } else {
                    return res.json({
                        message: "Sure. Which GitHub project board would you like me to check?"
                    });
                }
            }

            const releases = await withTimeout(
                runTool(client, intent, { owner: ownerGroup, projectNumber: savedPreference.project_id }),
                30000
            );
            const releaseList = releases.map((r: any) => `• ${r.content?.title ?? "Untitled Issue"}`).join("\n");

            return res.json({
                message: `Based on the current iteration in ${savedPreference.board_name}, this week's planned releases are:\n${releaseList || "• No current releases found."}`
            });

        } catch (error: any) {
            console.error("Pipeline Failure: ", error);
            if (error.message === "Request timed out") {
                return res.status(504).json({ error: "Request timed out" });
            }
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    async function getProjectIdByName(client: any, owner: string, name: string): Promise<number> {
        try {
            const discovery = await client.callTool({
                name: "projects_list",
                arguments: { owner }
            });

            const discoveryText = getMcpResponseText(discovery);
            if (!discoveryText.trim().startsWith('{') && !discoveryText.trim().startsWith('[')) {
                console.error("MCP Tool Error Output:", discoveryText);
                return 0;
            }

            const raw = JSON.parse(discoveryText);
            return raw.projects?.find((p: any) => p.title.toLowerCase().includes(name.toLowerCase()))?.number || 0;
        } catch (err) {
            console.error("Failed to parse project list:", err);
            return 0;
        }
    }

    const port = Number(process.env.PORT) || 8080;
    app.listen(port, () => console.log(`Stats Service online on: ${port}`));
}

main().catch(console.error);