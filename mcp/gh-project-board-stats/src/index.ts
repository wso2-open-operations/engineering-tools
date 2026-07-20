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
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
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

const choreoJwksUri = process.env.CHOREO_JWKS_URI || "https://sts.choreo.dev/oauth2/jwks";

const clientJwks = jwksClient({
    jwksUri: choreoJwksUri,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 600000
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
    clientJwks.getSigningKey(header.kid, (err, key) => {
        if (err || !key) {
            return callback(err || new Error("JWKS key match not found"));
        }
        const signingKey = key.getPublicKey();
        callback(null, signingKey);
    });
}

async function extractClaimsFromJwt(jwtAssertion: string): Promise<{ githubId: string; email: string } | null> {
    return new Promise((resolve) => {

        jwt.verify(jwtAssertion, getKey, { algorithms: ["RS256"] }, (err, decoded: any) => {
            if (err || !decoded) {
                console.error("JWT cryptographical verification constraint violation:", err?.message);
                return resolve(null);
            }

            if (!decoded.exp) {
                console.error("JWT configuration context error: Token missing explicit expiration 'exp' parameters.");
                return resolve(null);
            }

            const githubId = decoded.github_id || decoded.sub;
            const email = decoded.email;

            if (!githubId || !email) {
                console.error("JWT claims payload is missing required github_id or email fields.");
                return resolve(null);
            }

            resolve({
                githubId: String(githubId).trim(),
                email: String(email).trim()
            });
        });
    });
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
    const app = WebExpress();

    function WebExpress() {
        return express();
    }

    app.use(express.json({ limit: "10kb" }));

    app.get("/health", (_req, res) => {
        res.json({ status: "UP" });
    });

    app.post("/query", async (req, res) => {
        try {
            const question = req.body?.question;
            const ownerGroup = process.env.GITHUB_OWNER ?? "org-owner";

            const jwtAssertion = req.headers["x-jwt-assertion"];
            if (!jwtAssertion || typeof jwtAssertion !== "string") {
                return res.status(401).json({ error: "Missing identity assertion context token." });
            }

            const claims = await extractClaimsFromJwt(jwtAssertion);
            if (!claims || !/^[a-zA-Z0-9_\-]+$/.test(claims.githubId)) {
                return res.status(401).json({ error: "Invalid identity verification parameters." });
            }

            const { githubId, email } = claims;

            if (typeof question !== "string" || !question.trim()) {
                return res.status(400).json({ error: "Missing or invalid question" });
            }

            const [userRows]: any = await dbPool.execute(
                "SELECT github_id, email FROM users WHERE github_id = ?",
                [githubId]
            );

            if (userRows.length > 0) {
                if (userRows[0].email !== email) {
                    await dbPool.execute("UPDATE users SET email = ? WHERE github_id = ?", [email, githubId]);
                }
            } else {
                try {
                    await dbPool.execute(
                        "INSERT INTO users (github_id, email) VALUES (?, ?)",
                        [githubId, email]
                    );
                } catch (err: any) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        const [emailCheck]: any = await dbPool.execute(
                            "SELECT github_id FROM users WHERE email = ?",
                            [email]
                        );

                        if (emailCheck.length > 0 && emailCheck[0].github_id !== githubId) {
                            console.error("Unique Email collision encountered for a separate GitHub identity profile context.");
                            return res.status(409).json({ error: "Account mapping mismatch context configuration error." });
                        }

                        console.warn("Bypassed concurrent execution race condition for matching user profile.");
                    } else {
                        throw err;
                    }
                }
            }

            const [sessionRows]: any = await dbPool.execute("SELECT * FROM user_session_state WHERE github_id = ?", [githubId]);
            const [prefRows]: any = await dbPool.execute(
                "SELECT project_id, board_name FROM user_project_preferences WHERE github_id = ? AND is_remembered = 1",
                [githubId]
            );

            const session = sessionRows[0] || null;
            const savedPreferences: Array<{ project_id: number; board_name: string }> = prefRows || [];

            if (session && session.current_state === 'AWAITING_REMEMBER_CONFIRMATION') {
                const isYes = /^(yes|yep|sure|yeah|y)$/i.test(question.trim());
                const targetIteration = session.pending_iteration || 'this_week';

                const projectDetails = await withTimeout(30000, (signal) =>
                    getProjectIdAndTitleByName(client, ownerGroup, session.pending_board_name, signal)
                );

                if (!projectDetails) {
                    await dbPool.execute("DELETE FROM user_session_state WHERE github_id = ?", [githubId]);
                    return res.json({
                        message: `Hmm, I couldn't find "${session.pending_board_name}" on GitHub anymore. Let's try starting fresh.`
                    });
                }

                if (isYes) {
                    const [existing]: any = await dbPool.execute(
                        "SELECT 1 FROM user_project_preferences WHERE github_id = ? AND project_id = ?",
                        [githubId, projectDetails.number]
                    );

                    if (existing.length === 0) {
                        await dbPool.execute(
                            "INSERT INTO user_project_preferences (github_id, project_id, organization_name, board_name, is_remembered) VALUES (?, ?, ?, ?, 1)",
                            [githubId, projectDetails.number, ownerGroup, projectDetails.title]
                        );
                    } else {
                        await dbPool.execute(
                            "UPDATE user_project_preferences SET is_remembered = 1 WHERE github_id = ? AND project_id = ?",
                            [githubId, projectDetails.number]
                        );
                    }
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
                    ? `Awesome! I've saved "${projectDetails.title}" to your permanent tracking preferences.`
                    : `Got it, I won't save this board layout to your shortcuts.`;

                const responseMsg = `${saveMessage}\n\nHere are the planned releases from "${projectDetails.title}" for the ${formatIterationLabel(targetIteration)}:\n${releaseList || "• No active releases found."}`;

                await dbPool.execute("DELETE FROM user_session_state WHERE github_id = ?", [githubId]);
                return res.json({ message: responseMsg });
            }

            if (session && session.current_state === 'AWAITING_BOARD_SELECTION') {
                const chosenBoard = question.trim();

                const projectDetails = await withTimeout(30000, (signal) =>
                    getProjectIdAndTitleByName(client, ownerGroup, chosenBoard, signal)
                );

                if (!projectDetails) {
                    return res.json({
                        message: `I couldn't find a board named "${chosenBoard}". Please pick or type one of the exact names listed above.`
                    });
                }

                await dbPool.execute(
                    "UPDATE user_session_state SET current_state = 'AWAITING_REMEMBER_CONFIRMATION', pending_board_name = ? WHERE github_id = ?",
                    [projectDetails.title, githubId]
                );

                return res.json({
                    message: `Got it, pulling up "${projectDetails.title}". Would you like me to add this board to your saved preferences list so you can track it easily later?`
                });
            }

            const primaryContextName = savedPreferences.length > 0 ? savedPreferences[0].board_name : null;
            const rawIntent = await routeIntent(anthropic, question, primaryContextName);

            if (!rawIntent || typeof rawIntent !== "object") {
                throw new Error("Invalid shape: routeIntent did not return a valid object structure");
            }

            const intent = rawIntent as RoutedIntent;
            const resolvedIteration = intent.args?.iteration ?? 'this_week';

            let matchedPreference = null;
            if (intent.extractedBoardName) {
                matchedPreference = savedPreferences.find(
                    p => p.board_name.toLowerCase().trim() === intent.extractedBoardName!.toLowerCase().trim()
                );
            }

            if ((intent.status === "REQUIRES_BOARD_SELECTION" && !matchedPreference) || (savedPreferences.length === 0 && !intent.extractedBoardName)) {
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
                const githubBoardsList = projects.map((p: any) => p.title) ?? [];

                await dbPool.execute(
                    "INSERT INTO user_session_state (github_id, current_state, pending_iteration, pending_function) VALUES (?, 'AWAITING_BOARD_SELECTION', ?, ?) ON DUPLICATE KEY UPDATE current_state='AWAITING_BOARD_SELECTION', pending_iteration=?, pending_function=?",
                    [githubId, resolvedIteration, intent.args?.function ?? null, resolvedIteration, intent.args?.function ?? null]
                );

                let introductoryText = "Let's choose a project workspace. ";
                if (savedPreferences.length > 0) {
                    const savedNames = savedPreferences.map(p => `"${p.board_name}"`).join(", ");
                    introductoryText = `You currently have quick access shortcuts saved for: ${savedNames}. `;
                }

                if (githubBoardsList.length > 0) {
                    const boardOptions = githubBoardsList.map((b: string) => `• ${b}`).join("\n");
                    return res.json({
                        message: `${introductoryText}Here are the project boards available on your GitHub workspace:\n\n${boardOptions}\n\nWhich one would you like to view?`
                    });
                } else {
                    return res.json({
                        message: "Which GitHub project board should I take a look at?"
                    });
                }
            }

            if (intent.extractedBoardName) {
                if (matchedPreference) {
                    const releases = await withTimeout(30000, (signal) =>
                        runTool(client, intent, { owner: ownerGroup, projectNumber: matchedPreference.project_id }, signal)
                    );
                    const releaseList = releases.map((r: any) => `• ${r.content?.title ?? "Untitled Issue"}`).join("\n");

                    return res.json({
                        message: `Here are the planned releases for "${matchedPreference.board_name}" during the ${formatIterationLabel(resolvedIteration)}:\n\n${releaseList || "• No active releases found."}`
                    });
                } else {
                    const projectDetails = await withTimeout(30000, (signal) =>
                        getProjectIdAndTitleByName(client, ownerGroup, intent.extractedBoardName!, signal)
                    );

                    if (!projectDetails) {
                        return res.json({
                            message: `I noticed you wanted to open "${intent.extractedBoardName}", but I couldn't verify that exact board name on your GitHub workspace. Which project board should I check?`
                        });
                    }

                    const pendingFunc = intent.args?.function ?? null;
                    await dbPool.execute(
                        `INSERT INTO user_session_state 
                        (github_id, current_state, pending_iteration, pending_function, pending_board_name) 
                        VALUES (?, 'AWAITING_REMEMBER_CONFIRMATION', ?, ?, ?) 
                        ON DUPLICATE KEY UPDATE 
                        current_state='AWAITING_REMEMBER_CONFIRMATION', pending_iteration=?, pending_function=?, pending_board_name=?`,
                        [
                            githubId,
                            resolvedIteration,
                            pendingFunc,
                            projectDetails.title,
                            resolvedIteration,
                            pendingFunc,
                            projectDetails.title
                        ]
                    );

                    return res.json({
                        message: `Got it, I found "${projectDetails.title}". Would you like me to add this board to your saved preferences list so you can track it easily later?`
                    });
                }
            }

            const iterationLabel = formatIterationLabel(resolvedIteration);

            if (savedPreferences.length === 1) {
                const singlePref = savedPreferences[0];
                const releases = await withTimeout(30000, (signal) =>
                    runTool(client, intent, { owner: ownerGroup, projectNumber: singlePref.project_id }, signal)
                );
                const releaseList = releases.map((r: any) => `• ${r.content?.title ?? "Untitled Issue"}`).join("\n");
                return res.json({
                    message: `Here are the planned releases for "${singlePref.board_name}" during the ${iterationLabel}:\n\n${releaseList || "• No active releases found."}`
                });
            }

            const multiReleaseResults = await Promise.all(
                savedPreferences.map(async (pref) => {
                    try {
                        const releases = await withTimeout(15000, (signal) =>
                            runTool(client, intent, { owner: ownerGroup, projectNumber: pref.project_id }, signal)
                        );
                        return {
                            boardName: pref.board_name,
                            list: releases.map((r: any) => `  • ${r.content?.title ?? "Untitled Issue"}`).join("\n")
                        };
                    } catch (err) {
                        console.error(`Failed to fetch releases for board ${pref.board_name}:`, err);
                        return {
                            boardName: pref.board_name,
                            list: "  Unable to reach GitHub tracking data for this project right now."
                        };
                    }
                })
            );

            let combinedMessage = `Here is your status breakdown across your saved preferences for the ${iterationLabel}:\n\n`;

            const boardReports = multiReleaseResults.map((result) => {
                const content = result.list || "  • No active releases found for this cycle.";
                return `### ${result.boardName}\n${content}`;
            }).join("\n\n");

            return res.json({
                message: combinedMessage + boardReports
            });

        } catch (error: any) {
            console.error("Pipeline Failure: ", error);
            if (error.message === "Request timed out") {
                return res.status(504).json({ error: "The request timed out while communicating with GitHub. Please check back in a moment." });
            }
            return res.status(500).json({ error: "Internal server error. Something went wrong processing that request." });
        }
    });

    const port = Number(process.env.PORT) || 8080;
    app.listen(port, () => console.log(`Stats Service online on: ${port}`));
}

main().catch(console.error);