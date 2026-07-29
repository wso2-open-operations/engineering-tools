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

export function getIterationValue(item: any): any {
    const value = getProjectFieldValue(item, "Iteration");
    return value;
}

function startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function parseLocalDate(dateStr: string): Date {
    if (typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
        return new Date(`${dateStr.trim()}T00:00:00`);
    }
    return new Date(dateStr);
}

function getValidatedDuration(iteration: any): number | null {
    const duration = Number(iteration?.duration);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return duration;
}

function getIterationWindow(iteration: any): { start: Date; end: Date } | null {
    if (!iteration?.start_date) return null;

    const duration = getValidatedDuration(iteration);
    if (duration === null) return null;

    const start = startOfDay(parseLocalDate(iteration.start_date));
    if (isNaN(start.getTime())) return null;

    const end = new Date(start);
    end.setDate(start.getDate() + duration - 1);

    return { start, end };
}

export function isCurrentIteration(iteration: any): boolean {
    const window = getIterationWindow(iteration);
    if (!window) return false;

    const today = startOfDay(new Date());
    return today >= window.start && today <= window.end;
}

export function isMatchingIteration(
    iteration: any,
    requestedIteration?: string
): boolean {
    if (!iteration) return false;

    if (requestedIteration === "this_week") {
        return isCurrentIteration(iteration);
    }

    const title = typeof iteration === "string" ? iteration : iteration.title || iteration.name || "";
    if (requestedIteration) {
        return title.toLowerCase().includes(requestedIteration.toLowerCase());
    }

    return false;
}

/**
 * Resolves the title of the iteration based on the requested type.
 * @param allItems - The list of all items to search for iterations.
 * @param requested - The requested iteration type ("this_week", "next_week", or "previous_week").
 * @returns The title of the matching iteration, or null if not found.
 */
export function resolveIterationTargetTitle(
    allItems: any[],
    requested: "this_week" | "next_week" | "previous_week"
): string | null {
    const distinctByTitle = new Map<string, { title: string; start: Date; end: Date }>();

    for (const item of allItems) {
        const raw = getIterationValue(item);
        if (!raw || typeof raw !== "object") continue;

        const window = getIterationWindow(raw);
        if (!window) continue;

        const title = raw.title || raw.name || String(raw.id ?? "");
        if (!title || distinctByTitle.has(title)) continue;

        distinctByTitle.set(title, { title, start: window.start, end: window.end });
    }

    const distinct = Array.from(distinctByTitle.values()).sort(
        (a, b) => a.start.getTime() - b.start.getTime()
    );

    if (distinct.length === 0) return null;

    const today = startOfDay(new Date());
    const currentIdx = distinct.findIndex((it) => today >= it.start && today <= it.end);

    if (requested === "this_week") {
        return currentIdx >= 0 ? distinct[currentIdx].title : null;
    }

    if (requested === "next_week") {
        if (currentIdx >= 0 && currentIdx + 1 < distinct.length) {
            return distinct[currentIdx + 1].title;
        }
        const upcoming = distinct.find((it) => it.start > today);
        return upcoming ? upcoming.title : null;
    }

    if (requested === "previous_week") {
        if (currentIdx > 0) {
            return distinct[currentIdx - 1].title;
        }
        const past = [...distinct].reverse().find((it) => it.end < today);
        return past ? past.title : null;
    }

    return null;
}