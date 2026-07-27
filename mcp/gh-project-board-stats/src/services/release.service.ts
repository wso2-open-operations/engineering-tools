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


import { getProjectFieldValue } from "./projectItem.service";

export function isRelease(item: any): boolean {
    const labels = item.content?.labels ?? [];

    return labels.some((label: any) => {
        const labelName = (typeof label === "string" ? label : label?.name ?? "").trim().toLowerCase();

        if (labelName.startsWith("epic/") || labelName.startsWith("type/")) {
            return false;
        }

        return ["feature", "enhancement", "release"].some((keyword) =>
            labelName.includes(keyword)
        );
    });
}

export function belongsToFunction(item: any, functionName: string): boolean {
    const functionValue = getProjectFieldValue(item, "Function");

    if (!functionValue) {
        return false;
    }

    return String(functionValue).toLowerCase() === functionName.toLowerCase();
}

function getLabelNames(item: any): string[] {
    const labels = item.content?.labels ?? [];
    return labels.map((label: any) =>
        typeof label === "string" ? label : label?.name ?? ""
    );
}

export function isEpicTypeItem(item: any): boolean {
    const labels = getLabelNames(item);
    return labels.some((label) => label.toLowerCase() === "type/epic");
}

export function matchesEpicSearch(item: any, searchTerm: string): boolean {
    const labels = getLabelNames(item);

    const target = searchTerm
        .trim()
        .toLowerCase()
        .replace(/^epic\//, "")
        .trim();

    if (!target) return false;

    return labels.some((label) => {
        const match = /^epic\/(.+)$/i.exec(label.trim());
        if (!match) return false;
        return match[1].trim().toLowerCase().includes(target);
    });
}

export function getEpicLabelText(item: any): string | null {
    const labels = getLabelNames(item);
    for (const label of labels) {
        const match = /^epic\/(.+)$/i.exec(label.trim());
        if (match) return match[1].trim();
    }
    return null;
}