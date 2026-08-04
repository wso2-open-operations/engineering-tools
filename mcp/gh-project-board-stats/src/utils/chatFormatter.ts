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

/*
* This file contains utility functions for formatting chat messages in Markdown format
 */
import { STATUS_ORDER, STATUS_LABELS, canonicalizeStatus } from "../constants/status";

export interface MultiBoardResult {
    boardName: string;
    releases?: string[];
    items?: Array<{ title: string; epicLabel: string | null }>;
    error?: string | null;
}

export interface FormatReleaseListOptions {
    targetFunction?: string | null;
    epicSearch?: string | null;
    targetStatus?: string | null;
}

function dedupeByTitle<T extends { title: string } | string>(items: T[]): T[] {
    const seen = new Set<string>();
    const result: T[] = [];

    for (const item of items) {
        const title = typeof item === "string" ? item : item.title;
        const key = title.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }

    return result;
}

function getStatusRank(status: string): number {
    const canonical = canonicalizeStatus(status);
    return canonical ? STATUS_ORDER.indexOf(canonical) : -1;
}

function sortStatusGroups(statuses: string[]): string[] {
    return [...statuses].sort((a, b) => {
        const ai = getStatusRank(a);
        const bi = getStatusRank(b);
        if (ai === -1 && bi === -1) {
            return a.localeCompare(b);
        }
        if (ai === -1) {
            return 1;
        }
        if (bi === -1) {
            return -1;
        }
        return ai - bi;
    });
}

/**
 * Helper to build a natural conversational summary sentence 
 * using parsed intent arguments.
 */
function buildNaturalIntro(
    boardName: string,
    iterationLabel: string,
    intentArgs?: FormatReleaseListOptions
): string {
    const targetFunc = intentArgs?.targetFunction;
    const targetStatus = intentArgs?.targetStatus;

    const statusAdjective = targetStatus ? `${targetStatus} ` : "";

    if (targetFunc) {
        return `Here are the latest ${statusAdjective}updates for the **${targetFunc}** team on ${iterationLabel}:`;
    }

    if (targetStatus) {
        return `Here are the **${targetStatus}** items scheduled for **${boardName}** on ${iterationLabel}:`;
    }

    return `Here's what's scheduled for **${boardName}** on ${iterationLabel}:`;
}

export function formatReleaseList(
    boardName: string,
    iterationLabel: string,
    releases: Array<{ title: string; status: string }>,
    intentArgs?: FormatReleaseListOptions,
    prefix: string = ""
): string {
    const seen = new Set<string>();
    const cleanReleases = releases.filter((r) => {
        const key = r.title.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (cleanReleases.length === 0) {
        let subject = `on **${boardName}**`;
        if (intentArgs?.targetFunction) {
            subject = `for the **${intentArgs.targetFunction}** team`;
        }
        if (intentArgs?.targetStatus) {
            subject += ` matching status **"${intentArgs.targetStatus}"**`;
        }

        return `${prefix}Checked ${subject} for ${iterationLabel}, but couldn't find any items. Let me know if you want to look at another iteration, status, or epic.`;
    }

    const introHeader = `${prefix}${buildNaturalIntro(boardName, iterationLabel, intentArgs)}`;

    const grouped = new Map<string, string[]>();
    for (const item of cleanReleases) {
        if (!grouped.has(item.status)) grouped.set(item.status, []);
        grouped.get(item.status)!.push(item.title);
    }

    const orderedStatuses = sortStatusGroups(Array.from(grouped.keys()));

    let text = `${introHeader}\n\n`;

    text += orderedStatuses
        .map((status) => {
            const canonical = canonicalizeStatus(status);
            const display = canonical ? STATUS_LABELS[canonical] : status;
            const titles = grouped.get(status)!;
            const header = `**${display}** (${titles.length})`;
            const list = titles.map((t) => `* ${t}`).join("\n");
            return `${header}\n${list}`;
        })
        .join("\n\n");

    text += `\n\n_Want to drill into a specific epic, change iteration, or check another team?_`;

    return text.trim();
}

export function formatEpicList(
    boardName: string,
    epics: Array<{ title: string; epicLabel: string | null; status?: string }>,
    targetStatus?: string | null,
    prefix: string = ""
): string {
    const cleanEpics = dedupeByTitle(epics);

    if (cleanEpics.length === 0) {
        const statusMsg = targetStatus ? ` with status **"${targetStatus}"**` : "";
        return `${prefix}No Epics found on **${boardName}**${statusMsg}.`;
    }

    const statusHeader = targetStatus ? ` (${targetStatus})` : "";
    let text = `${prefix}Here are the active Epics${statusHeader} on **${boardName}**:\n\n`;
    text += cleanEpics.map((e) => `* **${e.title}**`).join("\n");
    text += `\n\n_Let me know if you want to inspect items under any of these Epics._`;

    return text.trim();
}

export function formatEpicSearchResults(
    boardName: string,
    searchTerm: string,
    items: Array<{ title: string; epicLabel: string | null; status?: string }>,
    targetStatus?: string | null,
    prefix: string = ""
): string {
    const cleanItems = dedupeByTitle(items);

    if (cleanItems.length === 0) {
        const statusMsg = targetStatus ? ` with status **"${targetStatus}"**` : "";
        return `${prefix}No items matched **"${searchTerm}"** on **${boardName}**${statusMsg}.`;
    }

    const statusHeader = targetStatus ? ` with status **"${targetStatus}"**` : "";
    let text = `${prefix}Here's what matched **"${searchTerm}"**${statusHeader} on **${boardName}**:\n\n`;
    text += cleanItems.map((i) => `* **${i.title}**`).join("\n");
    text += `\n\n_Need details on any of these items?_`;

    return text.trim();
}

export function formatMultiBoardReleases(
    iterationLabel: string,
    multiResults: MultiBoardResult[]
): string {
    let text = `Here's your release overview across your saved boards (${iterationLabel}):\n\n`;

    for (const b of multiResults) {
        text += `### **${b.boardName}**\n`;

        if (b.error) {
            text += `* _Could not fetch releases: ${b.error}_\n\n`;
            continue;
        }

        const releases = dedupeByTitle(b.releases || []);
        if (releases.length > 0) {
            text += releases.map((r) => `* **${r}**`).join("\n") + "\n\n";
        } else {
            text += "* _No releases found._\n\n";
        }
    }

    return text.trim();
}

export function formatMultiBoardEpicList(
    multiResults: MultiBoardResult[]
): string {
    let text = "Here are the Epics across your saved boards:\n\n";

    for (const b of multiResults) {
        text += `### **${b.boardName}**\n`;

        if (b.error) {
            text += `* _Could not fetch Epics: ${b.error}_\n\n`;
            continue;
        }

        const items = dedupeByTitle(b.items || []);
        if (items.length > 0) {
            text += items.map((i) => `* **${i.title}**`).join("\n") + "\n\n";
        } else {
            text += "* _No Epics found._\n\n";
        }
    }

    return text.trim();
}

export function formatMultiBoardEpicSearchResults(
    searchTerm: string,
    multiResults: MultiBoardResult[]
): string {
    let text = `Here's what matched **"${searchTerm}"** across your saved boards:\n\n`;

    for (const b of multiResults) {
        text += `### **${b.boardName}**\n`;

        if (b.error) {
            text += `* _Could not fetch matches: ${b.error}_\n\n`;
            continue;
        }

        const items = dedupeByTitle(b.items || []);
        if (items.length > 0) {
            text += items.map((i) => `* **${i.title}**`).join("\n") + "\n\n";
        } else {
            text += `* _No matches for "${searchTerm}"._\n\n`;
        }
    }

    return text.trim();
}