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

export interface RoutedIntent {
    status: "READY" | "REQUIRES_BOARD_SELECTION";
    extractedBoardName: string | null;
    args: {
        iteration: string;
        function: string | null;
    };
    conversationalResponse: string | null;
}

function withTimeout<T>(
    timeoutMs: number,
    operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
    const controller = new AbortController();

    const timeoutPromise = new Promise<T>((_, reject) => {
        const timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("Request timed out"));
        }, timeoutMs);
        controller.signal.addEventListener("abort", () => clearTimeout(timeout));
    });

    return Promise.race([
        operation(controller.signal),
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

function safeJsonParse(rawText: string): any {
    const trimmed = rawText.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        throw new Error(`Invalid non-JSON diagnostic payload returned from MCP backend: ${trimmed.slice(0, 150)}`);
    }
    return JSON.parse(trimmed);
}

async function getProjectIdAndTitleByName(
    client: any,
    owner: string,
    name: string,
    signal?: AbortSignal
): Promise<{ number: number; title: string } | null> {
    try {
        if (signal?.aborted) {
            throw new Error("Request aborted prior to execution");
        }

        const discovery = await client.callTool({
            name: "projects_list",
            arguments: { method: "list_projects", owner }
        });

        const discoveryText = getMcpResponseText(discovery);
        const raw = safeJsonParse(discoveryText);
        const projects = Array.isArray(raw) ? raw : (raw.projects || []);

        const matched = projects.find(
            (p: any) => p.title.toLowerCase().trim() === name.toLowerCase().trim()
        );

        return matched ? { number: matched.number, title: matched.title } : null;
    } catch (err) {
        console.error("Failed to parse project list:", err);
        return null;
    }
}

function formatIterationLabel(iteration: string): string {
    if (iteration === 'previous_week') return "previous week's iteration";
    if (iteration === 'next_week') return "next week's iteration";
    if (iteration === 'this_week') return "this week's iteration";
    return `iteration frame (${iteration})`;
}

async function main() {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("Initialization Failed: Missing ANTHROPIC_API_KEY environment variable");
    }

    await initializeDatabase();

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const client = await connectMCP();
    const app = express();

    app.use(express.json({ limit: "10kb" }));

    app.get("/health", (_req, res) => {
        res.json({ status: "UP" });
    });

    app.post("/query", async (req, res) => {
        try {
            const question = req.body?.question;
            const ownerGroup = process.env.GITHUB_OWNER ?? "org-owner";

            const rawUserHeader = req.headers["x-authenticated-user"];
            const userId = rawUserHeader ? String(rawUserHeader).trim() : null;

            if (!userId || !/^[a-zA-Z0-9_\-]+$/.test(userId)) {
                return res.status(401).json({ error: "Missing or invalid identity verification parameter context." });
            }

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
                const isYes = /^(yes|yep|sure|yeah|y)$/i.test(question.trim());
                const targetIteration = session.pending_iteration || 'this_week';

                const projectDetails = await withTimeout(30000, (signal) =>
                    getProjectIdAndTitleByName(client, ownerGroup, session.pending_board_name, signal)
                );

                if (!projectDetails) {
                    await dbPool.execute("DELETE FROM user_session_state WHERE user_id = ?", [userId]);
                    return res.json({
                        message: `I couldn't locate the board "${session.pending_board_name}" on GitHub anymore. Let's restart.`
                    });
                }

                if (isYes) {
                    await dbPool.execute(
                        "UPDATE user_project_preferences SET is_remembered = 0 WHERE user_id = ?",
                        [userId]
                    );

                    await dbPool.execute(
                        "INSERT INTO user_project_preferences (user_id, project_id, organization_name, board_name, is_remembered) VALUES (?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE project_id=?, board_name=?, is_remembered=1",
                        [userId, projectDetails.number, ownerGroup, projectDetails.title, projectDetails.number, projectDetails.title]
                    );
                }

                const intentArgs: RoutedIntent = {
                    status: "READY",
                    extractedBoardName: projectDetails.title,
                    args: {
                        iteration: targetIteration,
                        function: session.pending_function
                    },
                    conversationalResponse: null
                };

                const releases = await withTimeout(30000, (signal) =>
                    runTool(client, intentArgs, { owner: ownerGroup, projectNumber: projectDetails.number }, signal)
                );

                const releaseList = releases.map((r: any) => `• ${r.content?.title ?? "Untitled Issue"}`).join("\n");
                const saveMessage = isYes
                    ? "Great. I'll remember this board for your future queries!"
                    : "Got it. I won't remember this setting.";

                const responseMsg = `${saveMessage} Let me check the target timeline.\n\nAccording to the ${formatIterationLabel(targetIteration)}, the planned releases are:\n${releaseList || "• No active releases found."}`;

                await dbPool.execute("DELETE FROM user_session_state WHERE user_id = ?", [userId]);
                return res.json({ message: responseMsg });
            }

            if (session && session.current_state === 'AWAITING_BOARD_SELECTION') {
                const chosenBoard = question.trim();

                const projectDetails = await withTimeout(30000, (signal) =>
                    getProjectIdAndTitleByName(client, ownerGroup, chosenBoard, signal)
                );

                if (!projectDetails) {
                    return res.json({
                        message: `I couldn't find a board named "${chosenBoard}". Please type one of the valid options listed above.`
                    });
                }

                await dbPool.execute(
                    "UPDATE user_session_state SET current_state = 'AWAITING_REMEMBER_CONFIRMATION', pending_board_name = ? WHERE user_id = ?",
                    [projectDetails.title, userId]
                );

                return res.json({
                    message: `Got it. I'll use the "${projectDetails.title}". Should I remember this board for your future release queries?`
                });
            }

            const activeBoardName = savedPreference ? savedPreference.board_name : null;

            const rawIntent = await routeIntent(anthropic, question, activeBoardName);

            if (!rawIntent || typeof rawIntent !== "object") {
                throw new Error("Invalid shape: routeIntent did not return a valid object structure");
            }
            if (rawIntent.status !== "READY" && rawIntent.status !== "REQUIRES_BOARD_SELECTION") {
                throw new Error(`Invalid shape: Incorrect status flag value received ("${rawIntent.status}")`);
            }
            if (!rawIntent.args || typeof rawIntent.args !== "object") {
                throw new Error("Invalid shape: Missing internal arguments parameter container object");
            }
            if (typeof rawIntent.args.iteration !== "string") {
                throw new Error("Invalid shape: Missing or malformed iteration string marker value");
            }

            const intent = rawIntent as RoutedIntent;
            const resolvedIteration = intent.args?.iteration ?? 'this_week';

            if (intent.extractedBoardName) {
                const projectDetails = await withTimeout(30000, (signal) =>
                    getProjectIdAndTitleByName(client, ownerGroup, intent.extractedBoardName!, signal)
                );

                if (projectDetails) {
                    const releases = await withTimeout(30000, (signal) =>
                        runTool(client, intent, { owner: ownerGroup, projectNumber: projectDetails.number }, signal)
                    );
                    const releaseList = releases.map((r: any) => `• ${r.content?.title ?? "Untitled Issue"}`).join("\n");

                    return res.json({
                        message: `Based on the active configuration for "${projectDetails.title}", the planned releases for the ${formatIterationLabel(resolvedIteration)} are:\n${releaseList || "• No active releases found."}`
                    });
                }

                intent.status = "REQUIRES_BOARD_SELECTION";
            }

            if (intent.status === "REQUIRES_BOARD_SELECTION" || !savedPreference) {
                const discovery = await withTimeout(30000, (signal) => {
                    if (signal.aborted) return Promise.reject(new Error("Request aborted"));
                    return client.callTool({
                        name: "projects_list",
                        arguments: { method: "list_projects", owner: ownerGroup }
                    });
                });

                const discoveryText = getMcpResponseText(discovery);
                const raw = safeJsonParse(discoveryText);
                const projects = Array.isArray(raw) ? raw : (raw.projects || []);
                const boardsList = projects.map((p: any) => p.title) ?? [];

                await dbPool.execute(
                    "INSERT INTO user_session_state (user_id, current_state, pending_iteration, pending_function) VALUES (?, 'AWAITING_BOARD_SELECTION', ?, ?) ON DUPLICATE KEY UPDATE current_state='AWAITING_BOARD_SELECTION', pending_iteration=?, pending_function=?",
                    [userId, resolvedIteration, intent.args?.function ?? null, resolvedIteration, intent.args?.function ?? null]
                );

                if (boardsList.length > 0) {
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

            const releases = await withTimeout(30000, (signal) =>
                runTool(client, intent, { owner: ownerGroup, projectNumber: savedPreference.project_id }, signal)
            );
            const releaseList = releases.map((r: any) => `• ${r.content?.title ?? "Untitled Issue"}`).join("\n");

            return res.json({
                message: `Based on the active configuration for "${savedPreference.board_name}", the planned releases for the ${formatIterationLabel(resolvedIteration)} are:\n${releaseList || "• No active releases found."}`
            });

        } catch (error: any) {
            console.error("Pipeline Failure: ", error);
            if (error.message === "Request timed out") {
                return res.status(504).json({ error: "Request timed out" });
            }
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    const port = Number(process.env.PORT) || 8080;
    app.listen(port, () => console.log(`Stats Service online on: ${port}`));
}

main().catch(console.error);