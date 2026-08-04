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
import { getItemStatusText } from "./services/release.service";
import { initializeDatabase } from "./database/mysql";
import {
    formatReleaseList,
    formatEpicList,
    formatEpicSearchResults
} from "./utils/chatFormatter";
import { canonicalizeStatus } from "./constants/status";
import { authenticateRequest } from "./services/authentication.service";
import { getUserSession, setActiveBoard, clearActiveBoard, getSavedBoards } from "./services/session.service";
import { findMatchingBoards, resolveBoard, requiresBoardLookup } from "./services/board.service";
import { ensureUserExists } from "./services/project.service";

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

function toEpicItems(items: any[]): Array<{ title: string; epicLabel: string | null; status: string }> {
    return dedupeResultItems(items).map((item: any) => ({
        title: item.content?.title ?? "Untitled Issue",
        epicLabel: item.epicLabelText ?? null,
        status: getItemStatusText(item)
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
            text: formatEpicList(boardName, epics, intentArgs?.status),
            boardName,
            epics
        };
    }

    if (epicSearch) {
        const items = toEpicItems(results);
        return {
            type: "epic_search_results",
            text: formatEpicSearchResults(boardName, epicSearch, items, intentArgs?.status),
            boardName,
            searchTerm: epicSearch,
            items
        };
    }

    let releaseItems = toReleaseItemsWithStatus(results);

    const normalizedStatus = canonicalizeStatus(intentArgs?.status);

    if (normalizedStatus) {
        releaseItems = releaseItems.filter((item) => {
            const itemStatus = canonicalizeStatus(item.status);
            return itemStatus === normalizedStatus;
        });
    }

    const releases = releaseItems.map((r) => r.title);
    return {
        type: "release_list",
        text: formatReleaseList(
            boardName,
            formatIterationLabel(resolvedIteration),
            releaseItems,
            {
                targetFunction: intentArgs?.function,
                epicSearch: intentArgs?.epicSearch,
                targetStatus: intentArgs?.status
            }
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

            const user = await authenticateRequest(jwtAssertion);

            if (!user) {
                return res.status(401).json({
                    error:
                        "Could not verify user identity. Please sign in again."
                });
            }

            const { githubId, email } = user;

            if (typeof question !== "string" || !question.trim()) {
                return res.status(400).json({
                    error: "Please ask a specific question, for example: 'What are the releases for this week?'"
                });
            }

            await ensureUserExists(githubId, email);

            const session = await getUserSession(githubId);
            const activeBoardName = session?.activeBoardName ?? null;
            const activeProjectId = session?.activeProjectId ?? null;

            const intent = await routeIntent(anthropic, question, activeBoardName);

            // handle unsupported queries
            if (intent.status === "UNSUPPORTED") {
                return res.json({
                    type: "unsupported_query",
                    text: intent.conversationalResponse ||
                        "I can help you view project board releases, epics, features, and iteration items. I don't currently support general questions or direct repository actions."
                });
            }

            // Handle board switching / keyword search requests
            if (intent.isSwitchingBoard) {
                if (requiresBoardLookup(intent)) {
                    const resolution = await withTimeout(
                        30000,
                        (signal) =>
                            resolveBoard(
                                client,
                                ownerGroup,
                                intent.extractedBoardName!,
                                signal
                            )
                    );

                    // No match found -> ask user to clarify what they need
                    if (resolution.type === "NONE") {
                        return res.json({
                            type: "board_selection",
                            text: `I couldn't find any project board matching **"${intent.extractedBoardName}"** under **${ownerGroup}**.`
                        });
                    }

                    // Multiple matches found -> display options
                    if (resolution.type === "MULTIPLE") {
                        const boardListText = resolution.boards!.map(b => `* **${b.title}**`).join("\n");
                        return res.json({
                            type: "board_selection",
                            text: `I found multiple boards matching **"${intent.extractedBoardName}"**:\n\n${boardListText}\n\nWhich board would you like to use?`,
                            availableBoards: resolution.boards!.map(b => b.title),
                            extractedQuestion: question
                        });
                    }

                    const matchedBoardName = resolution.board!.title;
                    const matchedProjectId = resolution.board!.number;

                    if (!resolution.board!.confident) {
                        return res.json({
                            type: "board_selection",
                            text: `I found a possible match for **"${intent.extractedBoardName}"** but I'm not certain. Did you mean **${matchedBoardName}**?`,
                            availableBoards: [matchedBoardName],
                            extractedQuestion: question
                        });
                    }

                    await setActiveBoard(
                        githubId,
                        matchedBoardName,
                        matchedProjectId,
                        ownerGroup
                    );

                    return res.json({
                        type: "board_acknowledgment",
                        text: `Got it! Switched to **${matchedBoardName}**. What would you like to know about this board?`,
                        boardName: matchedBoardName
                    });
                }

                // Generic switch request without a board keyword
                await clearActiveBoard(githubId);

                const savedBoards = await getSavedBoards(githubId);
                if (savedBoards.length > 0) {
                    const topSavedBoards = savedBoards.slice(0, 5);
                    const savedListText = topSavedBoards
                        .map((b) => `* **${b.boardName}**`)
                        .join("\n");

                    return res.json({
                        type: "board_selection",
                        text: `Sure! Here are your recently accessed project boards:\n\n${savedListText}\n\nWhich board would you like to switch to?`,
                        savedBoards: topSavedBoards.map((b) => b.boardName)
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

            if (requiresBoardLookup(intent)) {
                const matches = await withTimeout(30000, (signal) =>
                    findMatchingBoards(client, ownerGroup, intent.extractedBoardName!, signal)
                );

                if (matches.length === 0) {
                    return res.json({
                        type: "board_selection",
                        text: `I couldn't find any board under **${ownerGroup}** matching **"${intent.extractedBoardName}"**. Could you please check the title or give me another keyword?`
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

                // Exactly 1 match found — only auto-switch if it was a
                if (!matches[0].confident) {
                    return res.json({
                        type: "board_selection",
                        text: `I found a possible match for **"${intent.extractedBoardName}"** but I'm not certain. Did you mean **${matches[0].title}**?`,
                        availableBoards: [matches[0].title],
                        extractedQuestion: question
                    });
                }

                targetBoardName = matches[0].title;
                targetProjectId = matches[0].number;

                await setActiveBoard(
                    githubId,
                    targetBoardName,
                    targetProjectId,
                    ownerGroup
                );

                const hasQueryArgs = Boolean(
                    intent.args?.iteration ||
                    intent.args?.function ||
                    intent.args?.epicSearch ||
                    intent.args?.status ||
                    listEpics
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
                const savedBoards = await getSavedBoards(githubId);

                if (savedBoards.length > 0) {
                    const topSavedBoards = savedBoards.slice(0, 5);
                    const savedListText = topSavedBoards
                        .map((b) => `* **${b.boardName}**`)
                        .join("\n");

                    return res.json({
                        type: "board_selection",
                        text: `Welcome back! Here are the project boards you've recently interacted with:\n\n${savedListText}\n\nWhich one would you like to check today?`,
                        savedBoards: topSavedBoards.map((b) => b.boardName)
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

            await setActiveBoard(
                githubId,
                targetBoardName,
                targetProjectId,
                ownerGroup
            );

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