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
import { getItemStatusText } from "./services/release.service";
import { dbPool, initializeDatabase } from "./database/mysql";
import {
    formatReleaseList,
    formatEpicList,
    formatEpicSearchResults
} from "./utils/chatFormatter";

interface BoardCandidate {
    number: number;
    title: string;
}

interface UserSavedBoard {
    projectId: number;
    boardName: string;
    organizationName: string;
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

function dedupeBoards(projects: BoardCandidate[]): BoardCandidate[] {
    const seen = new Map<number, BoardCandidate>();
    for (const p of projects) {
        if (!seen.has(p.number)) seen.set(p.number, p);
    }
    return Array.from(seen.values());
}

async function findMatchingBoards(
    client: any,
    owner: string,
    searchTerm: string,
    signal?: AbortSignal
): Promise<BoardCandidate[]> {
    const discovery = await client.callTool({
        name: "projects_list",
        arguments: { method: "list_projects", owner }
    });

    const discoveryText = getMcpResponseText(discovery);
    const raw = safeJsonParse(discoveryText);
    const projects = Array.isArray(raw) ? raw : (raw.projects || []);

    const target = searchTerm.toLowerCase().trim();

    // Exact substring matching against organization board titles
    const matches = projects
        .filter((p: any) => typeof p.title === "string" && p.title.toLowerCase().includes(target))
        .map((p: any) => ({ number: p.number, title: p.title }));

    return dedupeBoards(matches);
}

async function getUserSavedBoards(githubId: string): Promise<UserSavedBoard[]> {
    const [rows]: any = await dbPool.execute(
        `SELECT project_id, board_name, organization_name 
         FROM ghs_user_project_preferences 
         WHERE github_id = ? AND is_remembered = 1 
         ORDER BY last_accessed_at DESC`,
        [githubId]
    );

    return rows.map((r: any) => ({
        projectId: r.project_id,
        boardName: r.board_name,
        organizationName: r.organization_name
    }));
}

function formatIterationLabel(iteration: string): string {
    if (iteration === 'previous_week') return "previous week's iteration";
    if (iteration === 'next_week') return "next week's iteration";
    if (iteration === 'this_week') return "this week's iteration";
    return `iteration frame (${iteration})`;
}

function dedupeResultItems(results: any[]): any[] {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const item of results) {
        const rawKey =
            item.id ??
            item.content?.id ??
            item.content?.url ??
            (item.content?.number !== undefined ? String(item.content.number) : undefined);

        const key = rawKey ? String(rawKey) : "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function toReleaseItemsWithStatus(releases: any[]): Array<{ title: string; status: string }> {
    return dedupeResultItems(releases).map((r: any) => ({
        title: r.content?.title ?? "Untitled Issue",
        status: getItemStatusText(r)
    }));
}

function toEpicItems(items: any[]): Array<{ title: string; epicLabel: string | null }> {
    return dedupeResultItems(items).map((item: any) => ({
        title: item.content?.title ?? "Untitled Issue",
        epicLabel: item.epicLabelText ?? null
    }));
}

function truncateString(val: string | null | undefined, maxLen = 150): string | null {
    if (val === null || val === undefined) return null;
    const trimmed = val.trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, maxLen);
}

function groupByStatus(items: Array<{ title: string; status: string }>): Record<string, string[]> {
    const grouped: Record<string, string[]> = {};
    for (const item of items) {
        if (!grouped[item.status]) grouped[item.status] = [];
        grouped[item.status].push(item.title);
    }
    return grouped;
}

function buildResultsPayload(
    boardName: string,
    results: any[],
    resolvedIteration: string,
    epicSearch: string | null,
    listEpics: boolean,
    intentArgs?: any
): { type: string; text: string; boardName: string;[key: string]: any } {
    if (listEpics) {
        const epics = toEpicItems(results);
        return {
            type: "epic_list",
            text: formatEpicList(boardName, epics),
            boardName,
            epics
        };
    }

    if (epicSearch) {
        const items = toEpicItems(results);
        return {
            type: "epic_search_results",
            text: formatEpicSearchResults(boardName, epicSearch, items),
            boardName,
            searchTerm: epicSearch,
            items
        };
    }

    const releaseItems = toReleaseItemsWithStatus(results);
    const releases = releaseItems.map((r) => r.title);
    return {
        type: "release_list",
        text: formatReleaseList(
            boardName,
            formatIterationLabel(resolvedIteration),
            releaseItems,
            { targetFunction: intentArgs?.function, epicSearch: intentArgs?.epicSearch }
        ),
        boardName,
        iteration: resolvedIteration,
        releases,
        releasesByStatus: groupByStatus(releaseItems)
    };
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
                    error: "Your session has expired. Please sign in again."
                });
            }

            const claims = await extractClaimsFromJwt(jwtAssertion);
            if (!claims || !/^[a-zA-Z0-9_\-]+$/.test(claims.githubId)) {
                console.warn("Request rejected, token failed verification or claims look invalid.");
                return res.status(401).json({
                    error: "Could not verify user identity. Please sign in again."
                });
            }

            const { githubId, email } = claims;

            if (typeof question !== "string" || !question.trim()) {
                return res.status(400).json({
                    error: "Please ask a specific question, for example: 'What are the releases for this week?'"
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
                                error: "This email is already linked to another account. Please contact support."
                            });
                        }
                    } else {
                        throw err;
                    }
                }
            }

            const [sessionRows]: any = await dbPool.execute(
                "SELECT active_board_name, active_project_id FROM ghs_user_session_state WHERE github_id = ?",
                [githubId]
            );
            const session = sessionRows[0] || null;
            const activeBoardName: string | null = session?.active_board_name ?? null;
            const activeProjectId: number | null = session?.active_project_id ?? null;

            async function setActiveBoard(boardName: string, projectId: number) {
                const safeBoardName = truncateString(boardName, 255);

                await dbPool.execute(
                    `INSERT INTO ghs_user_session_state (github_id, active_board_name, active_project_id)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE active_board_name = ?, active_project_id = ?`,
                    [githubId, safeBoardName, projectId, safeBoardName, projectId]
                );

                await dbPool.execute(
                    `INSERT INTO ghs_user_project_preferences (github_id, project_id, organization_name, board_name, is_remembered)
                     VALUES (?, ?, ?, ?, 1)
                     ON DUPLICATE KEY UPDATE board_name = ?, organization_name = ?, last_accessed_at = CURRENT_TIMESTAMP`,
                    [githubId, projectId, ownerGroup, safeBoardName, safeBoardName, ownerGroup]
                );
            }

            async function clearActiveBoard() {
                await dbPool.execute(
                    `DELETE FROM ghs_user_session_state WHERE github_id = ?`,
                    [githubId]
                );
            }

            const intent = await routeIntent(anthropic, question, activeBoardName);

            // Explicit request to switch/change boards
            if (intent.isSwitchingBoard && !intent.extractedBoardName) {
                await clearActiveBoard();

                const savedBoards = await getUserSavedBoards(githubId);
                if (savedBoards.length > 0) {
                    const savedListText = savedBoards
                        .slice(0, 5)
                        .map((b) => `* **${b.boardName}**`)
                        .join("\n");

                    return res.json({
                        type: "board_selection",
                        text: `Sure! Here are your recently accessed project boards:\n\n${savedListText}\n\nWhich board would you like to switch to?`,
                        savedBoards: savedBoards.map((b) => b.boardName)
                    });
                }

                return res.json({
                    type: "board_selection",
                    text: "Sure! Which project board would you like to switch to? Give me the board name or a keyword."
                });
            }

            const resolvedIteration = intent.args?.iteration ?? 'this_week';
            const epicSearch = truncateString(intent.args?.epicSearch, 150);
            const listEpics = intent.args?.listEpics === true;

            let targetBoardName: string | null = null;
            let targetProjectId: number | null = null;

            if (intent.extractedBoardName) {
                const matches = await withTimeout(30000, (signal) =>
                    findMatchingBoards(client, ownerGroup, intent.extractedBoardName!, signal)
                );

                if (matches.length === 0) {
                    return res.json({
                        type: "board_selection",
                        text: `Couldn't find any board under **${ownerGroup}** matching **"${intent.extractedBoardName}"**. Please check the board title or try another keyword.`
                    });
                }

                // Multiple matching boards under the organization
                if (matches.length > 1) {
                    const boardListText = matches
                        .map((m) => `* **${m.title}**`)
                        .join("\n");

                    return res.json({
                        type: "board_selection",
                        text: `I found multiple project boards matching **"${intent.extractedBoardName}"** under **${ownerGroup}**:\n\n${boardListText}\n\nWhich specific board would you like to view?`,
                        availableBoards: matches.map((m) => m.title),
                        extractedQuestion: question
                    });
                }

                targetBoardName = matches[0].title;
                targetProjectId = matches[0].number;

                await setActiveBoard(targetBoardName, targetProjectId);

                const hasQueryArgs = Boolean(
                    intent.args?.iteration ||
                    intent.args?.function ||
                    intent.args?.epicSearch ||
                    intent.args?.listEpics
                );

                if (!hasQueryArgs) {
                    return res.json({
                        type: "board_acknowledgment",
                        text: `Got it, we're on **${targetBoardName}**. What's on your mind? Ask away—whether it's upcoming releases, specific epics, or feature statuses.`,
                        boardName: targetBoardName
                    });
                }

            } else if (activeBoardName && activeProjectId && !intent.isSwitchingBoard) {
                targetBoardName = activeBoardName;
                targetProjectId = activeProjectId;
            }

            if (!targetBoardName || !targetProjectId) {
                const savedBoards = await getUserSavedBoards(githubId);

                if (savedBoards.length > 0) {
                    const savedListText = savedBoards
                        .slice(0, 5)
                        .map((b) => `* **${b.boardName}**`)
                        .join("\n");

                    return res.json({
                        type: "board_selection",
                        text: `Welcome back! Here are the project boards you've recently interacted with:\n\n${savedListText}\n\nWhich one would you like to check today?`,
                        savedBoards: savedBoards.map((b) => b.boardName)
                    });
                }

                return res.json({
                    type: "board_selection",
                    text: "Which project board are we checking? Drop the board name or a keyword and I'll open it up."
                });
            }

            const results = await withTimeout(60000, (signal) =>
                runTool(client, intent, { owner: ownerGroup, projectNumber: targetProjectId! }, signal)
            );

            await setActiveBoard(targetBoardName, targetProjectId);

            const payload = buildResultsPayload(
                targetBoardName,
                results,
                resolvedIteration,
                epicSearch,
                listEpics,
                intent.args
            );
            return res.json(payload);

        } catch (error: any) {
            console.error("Request failed unexpectedly:", error);
            if (error.message === "Request timed out") {
                return res.status(504).json({
                    error: "GitHub response took too long to complete. Please try again in a moment."
                });
            }
            return res.status(500).json({
                error: "Internal server error. Please try again in a moment."
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