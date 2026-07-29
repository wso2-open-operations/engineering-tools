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
interface MultiBoardResult {
    boardName: string;
    releases?: string[];
    items?: Array<{ title: string; epicLabel: string | null }>;
    error?: string | null;
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

const STATUS_DISPLAY_ORDER = ["Done", "Testing/UAT", "In Progress", "Todo", "Backlog"];

function sortStatusGroups(statuses: string[]): string[] {
    return [...statuses].sort((a, b) => {
        const ai = STATUS_DISPLAY_ORDER.indexOf(a);
        const bi = STATUS_DISPLAY_ORDER.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });
}

export function formatReleaseList(
    boardName: string,
    iterationLabel: string,
    releases: Array<{ title: string; status: string }>,
    prefix: string = ""
): string {
    const seen = new Set<string>();
    const cleanReleases = releases.filter((r) => {
        const key = r.title.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    let text = `${prefix}Here are the releases for **${boardName}** (${iterationLabel}):\n\n`;

    if (cleanReleases.length === 0) {
        return `${prefix}No releases found for **${boardName}** (${iterationLabel}).`;
    }

    const grouped = new Map<string, string[]>();
    for (const item of cleanReleases) {
        if (!grouped.has(item.status)) grouped.set(item.status, []);
        grouped.get(item.status)!.push(item.title);
    }

    const orderedStatuses = sortStatusGroups(Array.from(grouped.keys()));

    text += orderedStatuses
        .map((status) => {
            const titles = grouped.get(status)!;
            const header = `**${status}** (${titles.length})`;
            const list = titles.map((t) => `* ${t}`).join("\n");
            return `${header}\n${list}`;
        })
        .join("\n\n");

    return text;
}

export function formatEpicList(
    boardName: string,
    epics: Array<{ title: string; epicLabel: string | null }>,
    prefix: string = ""
): string {
    const cleanEpics = dedupeByTitle(epics);

    let text = `${prefix}Here are the Epics for **${boardName}**:\n\n`;

    if (cleanEpics.length === 0) {
        return `${prefix}No Epics found for **${boardName}**.`;
    }

    text += cleanEpics.map((e) => `* **${e.title}**`).join("\n");
    return text;
}

export function formatEpicSearchResults(
    boardName: string,
    searchTerm: string,
    items: Array<{ title: string; epicLabel: string | null }>,
    prefix: string = ""
): string {
    const cleanItems = dedupeByTitle(items);

    let text = `${prefix}Here's what matched **"${searchTerm}"** on **${boardName}**:\n\n`;

    if (cleanItems.length === 0) {
        return `${prefix}No matches found for **"${searchTerm}"** on **${boardName}**.`;
    }

    text += cleanItems.map((i) => `* **${i.title}**`).join("\n");
    return text;
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