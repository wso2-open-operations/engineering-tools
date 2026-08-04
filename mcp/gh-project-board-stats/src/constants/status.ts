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

export const ITEM_STATUS = {
    DONE: "done",
    IN_PROGRESS: "in_progress",
    TESTING: "testing",
    TODO: "todo"
} as const;

export type ItemStatus = typeof ITEM_STATUS[keyof typeof ITEM_STATUS];

export const STATUS_ALIASES: Record<string, ItemStatus> = {
    done: ITEM_STATUS.DONE,
    completed: ITEM_STATUS.DONE,
    complete: ITEM_STATUS.DONE,
    finished: ITEM_STATUS.DONE,
    shipped: ITEM_STATUS.DONE,
    released: ITEM_STATUS.DONE,
    closed: ITEM_STATUS.DONE,

    "in progress": ITEM_STATUS.IN_PROGRESS,
    progress: ITEM_STATUS.IN_PROGRESS,
    ongoing: ITEM_STATUS.IN_PROGRESS,
    doing: ITEM_STATUS.IN_PROGRESS,
    developing: ITEM_STATUS.IN_PROGRESS,
    development: ITEM_STATUS.IN_PROGRESS,
    "in development": ITEM_STATUS.IN_PROGRESS,
    wip: ITEM_STATUS.IN_PROGRESS,

    testing: ITEM_STATUS.TESTING,
    qa: ITEM_STATUS.TESTING,
    uat: ITEM_STATUS.TESTING,
    review: ITEM_STATUS.TESTING,
    "under review": ITEM_STATUS.TESTING,

    todo: ITEM_STATUS.TODO,
    "to do": ITEM_STATUS.TODO,
    backlog: ITEM_STATUS.TODO,
    planned: ITEM_STATUS.TODO,
    open: ITEM_STATUS.TODO,
    "not started": ITEM_STATUS.TODO
};

export const STATUS_LABELS: Record<ItemStatus, string> = {
    [ITEM_STATUS.DONE]: "Done",
    [ITEM_STATUS.IN_PROGRESS]: "In Progress",
    [ITEM_STATUS.TESTING]: "Testing",
    [ITEM_STATUS.TODO]: "To Do"
};

export const STATUS_ORDER: ItemStatus[] = [
    ITEM_STATUS.DONE,
    ITEM_STATUS.TESTING,
    ITEM_STATUS.IN_PROGRESS,
    ITEM_STATUS.TODO
];

const ALIAS_KEYS_BY_LENGTH = Object.keys(STATUS_ALIASES).sort((a, b) => b.length - a.length);

const CANONICAL_VALUES: string[] = Object.values(ITEM_STATUS);

export function canonicalizeStatus(raw: string | null | undefined): ItemStatus | null {
    if (!raw) return null;

    const cleaned = raw.trim().toLowerCase();
    if (!cleaned) return null;

    if (CANONICAL_VALUES.includes(cleaned)) {
        return cleaned as ItemStatus;
    }

    if (STATUS_ALIASES[cleaned]) {
        return STATUS_ALIASES[cleaned];
    }

    const normalized = cleaned.replace(/[/\-_]+/g, " ").replace(/\s+/g, " ").trim();

    if (STATUS_ALIASES[normalized]) {
        return STATUS_ALIASES[normalized];
    }

    const tokens = normalized.split(" ");
    for (const key of ALIAS_KEYS_BY_LENGTH) {
        const keyTokens = key.split(" ");
        for (let i = 0; i + keyTokens.length <= tokens.length; i++) {
            if (keyTokens.every((t, j) => tokens[i + j] === t)) {
                return STATUS_ALIASES[key];
            }
        }
    }

    return null;
}