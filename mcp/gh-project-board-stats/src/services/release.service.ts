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

function getLabelNames(item: any): string[] {
    const raw = item?.content?.labels ?? item?.labels ?? [];
    const labels = Array.isArray(raw) ? raw : Array.isArray(raw?.nodes) ? raw.nodes : [];
    return labels.map((label: any) =>
        typeof label === "string" ? label : label?.name ?? ""
    );
}

function getItemTitle(item: any): string {
    return String(item?.content?.title ?? item?.title ?? "").trim();
}

function resolveFieldDisplayValue(value: any): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
        return String(value.name ?? value.value ?? value.title ?? value.label ?? "");
    }
    return String(value);
}

export function getItemStatusText(item: any): string {
    const statusValue = getProjectFieldValue(item, "Status");
    const text = resolveFieldDisplayValue(statusValue).trim();
    return text || "Unspecified";
}

export function belongsToFunction(item: any, functionName: string): boolean {
    if (!functionName) return true;

    const functionValue = getProjectFieldValue(item, "Function");
    const fieldText = resolveFieldDisplayValue(functionValue).toLowerCase().trim();
    if (!fieldText) return false;

    const target = functionName.toLowerCase().trim();
    if (fieldText === target) return true;
    return target.length >= 3 && fieldText.includes(target);
}

/**
 * Determines if the given item is a release, based on its "Type" field or labels.
 * @param item - The project item to check.
 * @returns True if the item is a release, false otherwise.
 */
export function isRelease(item: any): boolean {
    const typeValue = getProjectFieldValue(item, "Type");
    const typeText = resolveFieldDisplayValue(typeValue).toLowerCase().trim();

    if (typeText) {
        return typeText === "feature" || typeText === "enhancement" || typeText === "release";
    }

    const labels = getLabelNames(item);
    return labels.some((label) => {
        const name = label.trim().toLowerCase();
        if (name === "type/epic") return false;
        return ["feature", "enhancement", "release"].some((keyword) => name.includes(keyword));
    });
}

export function isEpicTypeItem(item: any): boolean {
    if (!item) return false;

    const labels: string[] = Array.isArray(item.labels)
        ? item.labels
        : Array.isArray(item.content?.labels)
            ? item.content.labels
            : [];

    const hasEpicOrFeatureLabel = labels.some((label: string) => {
        const l = typeof label === "string" ? label : (label as any)?.name ?? "";
        return /Type\/(Epic|New Feature)/i.test(l) || /^Feature$/i.test(l);
    });

    if (hasEpicOrFeatureLabel) return true;

    const fieldValues = item.fieldValues ?? item.content?.fieldValues ?? {};

    const typeValue = String(
        fieldValues["Type"]?.name ??
        fieldValues["Type"] ??
        fieldValues["type"]?.name ??
        fieldValues["type"] ??
        ""
    ).toLowerCase().trim();

    return ["feature", "epic", "new feature"].includes(typeValue);
}

export function matchesEpicSearch(item: any, searchTerm: string): boolean {
    const labels = getLabelNames(item);

    const target = searchTerm
        .trim()
        .toLowerCase()
        .replace(/^epic\//, "")
        .trim();

    if (!target) return false;

    const hasMatchingEpicLabel = labels.some((label) => {
        const match = /^epic\/(.+)$/i.exec(label.trim());
        if (!match) return false;
        return match[1].trim().toLowerCase().includes(target);
    });

    if (hasMatchingEpicLabel) return true;

    return getItemTitle(item).toLowerCase().includes(target);
}

export function getEpicLabelText(item: any): string | null {
    const labels = getLabelNames(item);
    for (const label of labels) {
        const match = /^epic\/(.+)$/i.exec(label.trim());
        if (match) return match[1].trim();
    }

    const titleMatch = /^\[epic\]\s*(.+)$/i.exec(getItemTitle(item));
    if (titleMatch) return titleMatch[1].trim();

    return null;
}