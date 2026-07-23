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
const asgardeoJwksUri = process.env.ASGARDEO_JWKS_URI || "https://api.asgardeo.io/t/wso2/oauth2/jwks";
const jwksUri = process.env.AUTH_ISSUER === "asgardeo" ? asgardeoJwksUri : choreoJwksUri;

const clientJwks = jwksClient({
    jwksUri,
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
                console.error("JWT signature verification failed:", err?.message);
                return resolve(null);
            }
            if (!decoded.exp) {
                console.error("Token is missing an expiration ('exp') claim, rejecting.");
                return resolve(null);
            }

            const githubId = decoded.github_id || decoded.sub;
            const email = decoded.email;

            if (!githubId || !email) {
                console.error("Token is missing required claims (github_id/sub or email).");
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
        console.error("Failed to fetch or parse the project list from GitHub:", err);
        return null;
    }
}

function formatIterationLabel(iteration: string): string {
    if (iteration === 'previous_week') return "previous week's iteration";
    if (iteration === 'next_week') return "next week's iteration";
    if (iteration === 'this_week') return "this week's iteration";
    return `iteration frame (${iteration})`;
}

function toReleaseTitles(releases: any[]): string[] {
    return releases.map((r: any) => r.content?.title ?? "Untitled Issue");
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

            const jwtAssertion = req.headers["x-jwt-assertion"];
            if (!jwtAssertion || typeof jwtAssertion !== "string") {
                console.warn("Request rejected, no x-jwt-assertion header present.");
                return res.status(401).json({
                    error: "You're not signed in, or your session has expired. Please sign in again."
                });
            }

            const claims = await extractClaimsFromJwt(jwtAssertion);
            if (!claims || !/^[a-zA-Z0-9_\-]+$/.test(claims.githubId)) {
                console.warn("Request rejected, token failed verification or claims look invalid.");
                return res.status(401).json({
                    error: "We couldn't verify your identity. Please sign in again."
                });
            }

            const { githubId, email } = claims;

            if (typeof question !== "string" || !question.trim()) {
                return res.status(400).json({
                    error: "Please include a question, like \"What are the releases for this week?\""
                });
            }

            const [userRows]: any = await dbPool.execute(
                "SELECT github_id, email FROM ghs_users WHERE github_id = ?",
                [githubId]
            );

            if (userRows.length > 0) {
                if (userRows[0].email !== email) {
                    await dbPool.execute("UPDATE ghs_users SET email = ? WHERE github_id = ?", [email, githubId]);
                }
            } else {
                try {
                    await dbPool.execute(
                        "INSERT INTO ghs_users (github_id, email) VALUES (?, ?)",
                        [githubId, email]
                    );

                } catch (err: any) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        const [emailCheck]: any = await dbPool.execute(
                            "SELECT github_id FROM ghs_users WHERE email = ?",
                            [email]
                        );

                        if (emailCheck.length > 0 && emailCheck[0].github_id !== githubId) {
                            return res.status(409).json({
                                error: "This email is already linked to a different account. Please contact support."
                            });
                        }
                    } else {
                        throw err;
                    }
                }
            }

            const [sessionRows]: any = await dbPool.execute("SELECT * FROM ghs_user_session_state WHERE github_id = ?", [githubId]);
            const [prefRows]: any = await dbPool.execute(
                "SELECT project_id, board_name FROM ghs_user_project_preferences WHERE github_id = ? AND is_remembered = 1",
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
                    await dbPool.execute("DELETE FROM ghs_user_session_state WHERE github_id = ?", [githubId]);
                    return res.json({
                        type: "error",
                        message: `I couldn't find "${session.pending_board_name}" on GitHub anymore. Let's start fresh, which board would you like to check?`
                    });
                }

                if (isYes) {
                    const [existing]: any = await dbPool.execute(
                        "SELECT 1 FROM ghs_user_project_preferences WHERE github_id = ? AND project_id = ?",
                        [githubId, projectDetails.number]
                    );

                    if (existing.length === 0) {
                        await dbPool.execute(
                            "INSERT INTO ghs_user_project_preferences (github_id, project_id, organization_name, board_name, is_remembered) VALUES (?, ?, ?, ?, 1)",
                            [githubId, projectDetails.number, ownerGroup, projectDetails.title]
                        );
                    } else {
                        await dbPool.execute(
                            "UPDATE ghs_user_project_preferences SET is_remembered = 1 WHERE github_id = ? AND project_id = ?",
                            [githubId, projectDetails.number]
                        );
                    }
                }

                const intentArgs: RoutedIntent = {
                    status: "READY",
                    extractedBoardName: projectDetails.title,
                    args: { iteration: targetIteration, function: session.pending_function },
                    conversationalResponse: null
                };

                const releases = await withTimeout(30000, (signal) =>
                    runTool(client, intentArgs, { owner: ownerGroup, projectNumber: projectDetails.number }, signal)
                );

                await dbPool.execute("DELETE FROM ghs_user_session_state WHERE github_id = ?", [githubId]);

                return res.json({
                    type: "release_list",
                    saved: isYes,
                    message: isYes
                        ? `Saved "${projectDetails.title}" to your boards. Here's what's planned for the ${formatIterationLabel(targetIteration)}:`
                        : `No problem, I won't save it. Here's what's planned for the ${formatIterationLabel(targetIteration)}:`,
                    boardName: projectDetails.title,
                    iteration: targetIteration,
                    releases: toReleaseTitles(releases)
                });
            }

            if (session && session.current_state === 'AWAITING_BOARD_SELECTION') {
                const chosenBoard = question.trim();

                const projectDetails = await withTimeout(30000, (signal) =>
                    getProjectIdAndTitleByName(client, ownerGroup, chosenBoard, signal)
                );

                if (!projectDetails) {
                    return res.json({
                        type: "board_selection",
                        message: `I couldn't find a board named "${chosenBoard}". Please type one of the board names from the list above.`
                    });
                }

                await dbPool.execute(
                    "UPDATE ghs_user_session_state SET current_state = 'AWAITING_REMEMBER_CONFIRMATION', pending_board_name = ? WHERE github_id = ?",
                    [projectDetails.title, githubId]
                );

                return res.json({
                    type: "confirmation",
                    message: `Got it, I'll use "${projectDetails.title}". Want me to remember this board for next time?`,
                    boardName: projectDetails.title
                });
            }

            const primaryContextName = savedPreferences.length > 0 ? savedPreferences[0].board_name : null;
            const rawIntent = await routeIntent(anthropic, question, primaryContextName);

            if (!rawIntent || typeof rawIntent !== "object") {
                throw new Error("routeIntent did not return a valid object, check the LLM response shape.");
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
                    "INSERT INTO ghs_user_session_state (github_id, current_state, pending_iteration, pending_function) VALUES (?, 'AWAITING_BOARD_SELECTION', ?, ?) ON DUPLICATE KEY UPDATE current_state='AWAITING_BOARD_SELECTION', pending_iteration=?, pending_function=?",
                    [githubId, resolvedIteration, intent.args?.function ?? null, resolvedIteration, intent.args?.function ?? null]
                );

                const message = savedPreferences.length > 0
                    ? "You already have some boards saved. Which one would you like to check, or pick a new one below?"
                    : "Which GitHub project board would you like me to check?";

                return res.json({
                    type: "board_selection",
                    message,
                    savedBoards: savedPreferences.map(p => p.board_name),
                    availableBoards: githubBoardsList
                });
            }

            if (intent.extractedBoardName) {
                if (matchedPreference) {
                    const releases = await withTimeout(30000, (signal) =>
                        runTool(client, intent, { owner: ownerGroup, projectNumber: matchedPreference.project_id }, signal)
                    );

                    return res.json({
                        type: "release_list",
                        message: `Here's what's planned for "${matchedPreference.board_name}" during the ${formatIterationLabel(resolvedIteration)}:`,
                        boardName: matchedPreference.board_name,
                        iteration: resolvedIteration,
                        releases: toReleaseTitles(releases)
                    });
                }

                const projectDetails = await withTimeout(30000, (signal) =>
                    getProjectIdAndTitleByName(client, ownerGroup, intent.extractedBoardName!, signal)
                );

                if (!projectDetails) {
                    return res.json({
                        type: "board_selection",
                        message: `I couldn't find a board called "${intent.extractedBoardName}" on your GitHub workspace. Which board would you like me to check?`
                    });
                }

                const pendingFunc = intent.args?.function ?? null;
                await dbPool.execute(
                    `INSERT INTO ghs_user_session_state
                    (github_id, current_state, pending_iteration, pending_function, pending_board_name)
                    VALUES (?, 'AWAITING_REMEMBER_CONFIRMATION', ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                    current_state='AWAITING_REMEMBER_CONFIRMATION', pending_iteration=?, pending_function=?, pending_board_name=?`,
                    [githubId, resolvedIteration, pendingFunc, projectDetails.title, resolvedIteration, pendingFunc, projectDetails.title]
                );

                return res.json({
                    type: "confirmation",
                    message: `Found "${projectDetails.title}". Want me to remember this board for next time?`,
                    boardName: projectDetails.title
                });
            }

            const iterationLabel = formatIterationLabel(resolvedIteration);

            if (savedPreferences.length === 1) {
                const singlePref = savedPreferences[0];
                const releases = await withTimeout(30000, (signal) =>
                    runTool(client, intent, { owner: ownerGroup, projectNumber: singlePref.project_id }, signal)
                );

                return res.json({
                    type: "release_list",
                    message: `Here's what's planned for "${singlePref.board_name}" during the ${iterationLabel}:`,
                    boardName: singlePref.board_name,
                    iteration: resolvedIteration,
                    releases: toReleaseTitles(releases)
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
                            releases: toReleaseTitles(releases),
                            error: null as string | null
                        };
                    } catch (err) {
                        console.error(`Couldn't fetch releases for board "${pref.board_name}":`, err);
                        return {
                            boardName: pref.board_name,
                            releases: [] as string[],
                            error: "Unable to reach GitHub for this board right now."
                        };
                    }
                })
            );

            return res.json({
                type: "multi_board_release_list",
                message: `Here's your release breakdown across all saved boards for the ${iterationLabel}:`,
                iteration: resolvedIteration,
                boards: multiReleaseResults
            });

        } catch (error: any) {
            console.error("Request failed unexpectedly:", error);
            if (error.message === "Request timed out") {
                return res.status(504).json({
                    error: "That took too long reaching GitHub. Please try again in a moment."
                });
            }
            return res.status(500).json({
                error: "Something went wrong on our end. Please try again in a moment."
            });
        }
    });

    const port = Number(process.env.PORT) || 8080;
    app.listen(port, () => console.log(`Stats Service is up and running on port ${port}.`));
}

main().catch((err) => {
    console.error("Fatal error during startup, service failed to start:", err);
    process.exit(1);
});