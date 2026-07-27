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

export function formatReleaseList(
    boardName: string,
    iterationLabel: string,
    releases: string[],
    prefix: string = ""
): string {
    let text = `${prefix}Here are the releases for **${boardName}** (${iterationLabel}):\n\n`;

    if (releases.length === 0) {
        return `${prefix}No releases found for **${boardName}** (${iterationLabel}).`;
    }

    text += releases.map((title) => `* **${title}**`).join("\n");
    return text;
}

export function formatEpicList(
    boardName: string,
    epics: Array<{ title: string; epicLabel: string | null }>,
    prefix: string = ""
): string {
    let text = `${prefix}Here are the Epics for **${boardName}**:\n\n`;

    if (epics.length === 0) {
        return `${prefix}No Epics found for **${boardName}**.`;
    }

    text += epics.map((e) => `* **${e.title}**`).join("\n");
    return text;
}

export function formatEpicSearchResults(
    boardName: string,
    searchTerm: string,
    items: Array<{ title: string; epicLabel: string | null }>,
    prefix: string = ""
): string {
    let text = `${prefix}Here's what matched **"${searchTerm}"** on **${boardName}**:\n\n`;

    if (items.length === 0) {
        return `${prefix}No matches found for **"${searchTerm}"** on **${boardName}**.`;
    }

    text += items.map((i) => `* **${i.title}**`).join("\n");
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

        if (b.releases && b.releases.length > 0) {
            text += b.releases.map((r) => `* **${r}**`).join("\n") + "\n\n";
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

        if (b.items && b.items.length > 0) {
            text += b.items.map((i) => `* **${i.title}**`).join("\n") + "\n\n";
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

        if (b.items && b.items.length > 0) {
            text += b.items.map((i) => `* **${i.title}**`).join("\n") + "\n\n";
        } else {
            text += `* _No matches for "${searchTerm}"._\n\n`;
        }
    }

    return text.trim();
}