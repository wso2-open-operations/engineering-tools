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

import { getIterationValue, isMatchingIteration, resolveIterationTargetTitle } from "../services/iteration.service";
import { getFieldId } from "../services/projectField.service";
import { isRelease, belongsToFunction, isEpicTypeItem, matchesEpicSearch, getEpicLabelText, getItemStatusText } from "../services/release.service";
import { dbPool } from "../database/mysql";

interface RuntimeTarget {
    owner: string;
    projectNumber: number;
}

const STANDARD_ITERATION_KEYS = new Set(["this_week", "next_week", "previous_week"]);

function getMcpResponseText(result: any): string {
    if (!result?.content || !Array.isArray(result.content)) {
        return "";
    }

    return result.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
}

function safeJsonParse(text: string): any {
    const trimmed = text.trim();

    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        throw new Error(`Invalid MCP response:\n${trimmed}`);
    }

    return JSON.parse(trimmed);
}

export async function runTool(
    client: any,
    route: any,
    target: RuntimeTarget,
    signal?: AbortSignal
) {
    const [metaRows]: any = await dbPool.execute(
        `SELECT layout_type, release_column_name
         FROM ghs_project_board_metadata
         WHERE project_id = ?`,
        [target.projectNumber]
    );

    const layoutType =
        metaRows.length > 0
            ? metaRows[0].layout_type
            : "ITERATION_BASED";

    const releaseColumn =
        metaRows.length > 0 && metaRows[0].release_column_name
            ? metaRows[0].release_column_name
            : "Done";

    const fieldsResult = await client.callTool({
        name: "projects_list",
        arguments: {
            method: "list_project_fields",
            owner: target.owner,
            project_number: target.projectNumber
        }
    });

    const fields = safeJsonParse(getMcpResponseText(fieldsResult));

    const fieldIds: string[] = [];

    if (layoutType === "ITERATION_BASED") {
        const id = getFieldId(fields.fields, "Iteration");
        if (id) fieldIds.push(id);
    }

    if (route?.args?.function) {
        const id = getFieldId(fields.fields, "Function");
        if (id) fieldIds.push(id);
    }

    const typeFieldId = getFieldId(fields.fields, "Type");
    if (typeFieldId && !fieldIds.includes(typeFieldId)) {
        fieldIds.push(typeFieldId);
    }

    const statusFieldId = getFieldId(fields.fields, "Status");
    if (statusFieldId && !fieldIds.includes(statusFieldId)) {
        fieldIds.push(statusFieldId);
    }

    const allItems: any[] = [];
    const seenItemKeys = new Set<string>();

    function itemKey(item: any): string {
        const rawKey =
            item.id ??
            item.content?.id ??
            item.content?.url ??
            (item.content?.number !== undefined ? String(item.content.number) : undefined);

        return rawKey ? String(rawKey) : "";
    }

    const PER_PAGE = 100;
    const MAX_ROUNDS = 20; // Safety limit to prevent infinite loops in case of unexpected pagination behavior

    let afterCursor: string | undefined = undefined;
    let round = 0;

    while (round < MAX_ROUNDS) {
        if (signal?.aborted) {
            console.warn("Operation aborted by signal.");
            break;
        }

        const itemsResult = await client.callTool({
            name: "projects_list",
            arguments: {
                method: "list_project_items",
                owner: target.owner,
                project_number: target.projectNumber,
                per_page: PER_PAGE,
                after: afterCursor,
                fields: fieldIds
            }
        });

        const rawText = getMcpResponseText(itemsResult);
        const parsed = safeJsonParse(rawText);

        const items = parsed.items ?? [];

        for (const item of items) {
            const key = itemKey(item);
            if (!key || seenItemKeys.has(key)) continue;
            seenItemKeys.add(key);
            allItems.push(item);
        }

        round++;

        const hasNextPage: boolean = parsed.pageInfo?.hasNextPage === true;
        const nextCursor: string | null = parsed.pageInfo?.nextCursor ?? null;

        if (items.length === 0 || !hasNextPage || !nextCursor || nextCursor === afterCursor) {
            break;
        }

        afterCursor = nextCursor;

        if (round >= MAX_ROUNDS) {
            console.warn(
                `Reached maximum safety pagination limit of ${MAX_ROUNDS} rounds; results may be incomplete.`
            );
        }
    }

    // filtering logic based on route arguments
    const listEpics: boolean = route?.args?.listEpics === true;
    const epicSearch: string | null = route?.args?.epicSearch ?? null;
    const requestedFunction: string | null = route?.args?.function ?? null;
    const requestedIteration: string | undefined = route?.args?.iteration;

    let iterationTargetTitle: string | null = null;
    if (
        layoutType === "ITERATION_BASED" &&
        requestedIteration &&
        STANDARD_ITERATION_KEYS.has(requestedIteration)
    ) {
        iterationTargetTitle = resolveIterationTargetTitle(
            allItems,
            requestedIteration as "this_week" | "next_week" | "previous_week"
        );
    }

    function matchesTimeOrStatusFilter(item: any): boolean {
        if (layoutType !== "ITERATION_BASED") {
            return getItemStatusText(item).toLowerCase() === releaseColumn.toLowerCase();
        }

        if (!requestedIteration) return true;

        const iterationValue = getIterationValue(item);

        if (STANDARD_ITERATION_KEYS.has(requestedIteration)) {
            if (!iterationTargetTitle) return false;
            const title = iterationValue?.title || iterationValue?.name || "";
            return title === iterationTargetTitle;
        }

        return isMatchingIteration(iterationValue, requestedIteration);
    }

    if (listEpics) {
        return allItems.filter((item: any) => {
            if (!isEpicTypeItem(item)) return false;
            if (requestedFunction && !belongsToFunction(item, requestedFunction)) return false;
            if (!matchesTimeOrStatusFilter(item)) return false;
            return true;
        });
    }

    if (epicSearch) {
        return allItems
            .filter((item: any) => {
                if (!matchesEpicSearch(item, epicSearch)) return false;
                if (requestedFunction && !belongsToFunction(item, requestedFunction)) return false;
                if (!matchesTimeOrStatusFilter(item)) return false;
                return true;
            })
            .map((item: any) => ({
                ...item,
                epicLabelText: getEpicLabelText(item)
            }));
    }

    return allItems.filter((item: any) => {
        if (!isRelease(item)) return false;
        if (requestedFunction && !belongsToFunction(item, requestedFunction)) return false;
        if (!matchesTimeOrStatusFilter(item)) return false;
        return true;
    });
}