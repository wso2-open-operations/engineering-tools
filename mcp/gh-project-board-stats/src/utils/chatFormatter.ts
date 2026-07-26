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

export interface EpicItem {
    title: string;
    epicLabel: string | null;
}

// Formats a list of releases for a board 
export function formatReleaseList(boardName: string, iterationLabel: string, releases: string[], savedPrefix: string = ""): string {
    const header = `${savedPrefix}Here's what's planned for **${boardName}** during the **${iterationLabel}**:`;

    if (!releases || releases.length === 0) {
        return `${header}\n\n*No releases or new features scheduled for this period! All clear.*`;
    }

    const itemsList = releases.map(r => `*  **${r}**`).join("\n");
    return `${header}\n\n${itemsList}\n\n_Need to filter by team or check another iteration? Just let me know!_`;
}

// Formats a list of Epics for a board 
export function formatEpicList(boardName: string, epics: EpicItem[], savedPrefix: string = ""): string {
    const header = `${savedPrefix}Here are the active Epics on **${boardName}**:`;

    if (!epics || epics.length === 0) {
        return `${header}\n\n*No Epics found on this board.*`;
    }

    const itemsList = epics.map(e => {
        const tag = e.epicLabel ? ` \`[${e.epicLabel}]\`` : "";
        return `* **${e.title}**${tag}`;
    }).join("\n");

    return `${header}\n\n${itemsList}\n\n_Type something like "what's under <epic-name>" to see items under a specific Epic._`;
}

// Formats a list of search results for Epics on a board 
export function formatEpicSearchResults(boardName: string, searchTerm: string, items: EpicItem[], savedPrefix: string = ""): string {
    const header = `${savedPrefix}Here's what's tagged under **"${searchTerm}"** on **${boardName}**:`;

    if (!items || items.length === 0) {
        return `${header}\n\n*No items found matching "${searchTerm}".*`;
    }

    const itemsList = items.map(i => {
        const tag = i.epicLabel ? ` \`[EPIC/${i.epicLabel}]\`` : "";
        return `* **${i.title}**${tag}`;
    }).join("\n");

    return `${header}\n\n${itemsList}`;
}

// Formats a multi-board release overview 
export function formatMultiBoardReleases(iterationLabel: string, boards: Array<{ boardName: string; releases?: string[]; error?: string | null }>): string {
    let output = `Here is your release overview across all saved boards for the **${iterationLabel}**:\n\n`;

    for (const b of boards) {
        output += `### **${b.boardName}**\n`;
        if (b.error) {
            output += `*  _${b.error}_\n\n`;
            continue;
        }

        if (!b.releases || b.releases.length === 0) {
            output += `* _No scheduled releases._\n\n`;
        } else {
            output += b.releases.map(r => `*  ${r}`).join("\n") + "\n\n";
        }
    }

    return output.trim();
}