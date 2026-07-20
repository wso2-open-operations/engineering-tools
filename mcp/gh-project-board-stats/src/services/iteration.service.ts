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

import { getProjectFieldValue }
    from "./projectItem.service";

export function getIterationValue(item: any) {
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
    if (!Number.isFinite(duration) || duration <= 0) {
        console.warn(
            "[Warning] Invalid or missing iteration.duration:",
            iteration?.duration
        );
        return null;
    }
    return duration;
}

function getIterationWindow(iteration: any): { start: Date; end: Date } | null {
    if (!iteration?.start_date) {
        return null;
    }

    const duration = getValidatedDuration(iteration);
    if (duration === null) {
        return null;
    }

    const start = startOfDay(parseLocalDate(iteration.start_date));
    if (isNaN(start.getTime())) {
        console.warn("[Warning] Invalid iteration.start_date:", iteration.start_date);
        return null;
    }

    const end = new Date(start);
    end.setDate(start.getDate() + duration - 1);

    return { start, end };
}

export function isCurrentIteration(iteration: any) {
    const window = getIterationWindow(iteration);
    if (!window) {
        return false;
    }

    const today = startOfDay(new Date());
    return today >= window.start && today <= window.end;
}

export function isMatchingIteration(
    iteration: any,
    requestedIteration?: string
) {
    if (!iteration) {
        return false;
    }

    if (requestedIteration === "this_week") {
        return isCurrentIteration(iteration);
    }

    if (requestedIteration === "next_week") {
        const window = getIterationWindow(iteration);
        if (!window) {
            return false;
        }

        const today = startOfDay(new Date());
        const duration = getValidatedDuration(iteration)!;

        const targetFutureDate = new Date(today);
        targetFutureDate.setDate(today.getDate() + duration);

        return (
            targetFutureDate >= window.start &&
            targetFutureDate <= window.end
        );
    }

    if (requestedIteration === "previous_week") {
        const window = getIterationWindow(iteration);
        if (!window) {
            return false;
        }

        const today = startOfDay(new Date());
        const duration = getValidatedDuration(iteration)!;

        const targetPastDate = new Date(today);
        targetPastDate.setDate(today.getDate() - duration);

        return (
            targetPastDate >= window.start &&
            targetPastDate <= window.end
        );
    }

    return false;
}