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

import { getIterationValue, isMatchingIteration } from "../services/iteration.service";
import { getFieldId } from "../services/projectField.service";
import { isRelease, belongsToFunction, isEpicTypeItem, matchesEpicSearch, getEpicLabelText } from "../services/release.service";
import { dbPool } from "../database/mysql";

interface RuntimeTarget {
    owner: string;
    projectNumber: number;
}

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

function matchesLayoutFilter(
    item: any,
    layoutType: string,
    releaseColumn: string,
    requestedIteration?: string
): boolean {
    if (layoutType === "ITERATION_BASED") {

        if (!requestedIteration) return true;
        const iteration = getIterationValue(item);
        return isMatchingIteration(iteration, requestedIteration);
    }

    const status =
        item.fields?.find(
            (f: any) => f.name?.toLowerCase() === "status"
        )?.value ?? "";

    return String(status).toLowerCase() === releaseColumn.toLowerCase();
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
        metaRows.length > 0
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
    } else {
        const id = getFieldId(fields.fields, "Status");
        if (id) fieldIds.push(id);
    }

    if (route?.args?.function) {
        const id = getFieldId(fields.fields, "Function");
        if (id) fieldIds.push(id);
    }

    const allItems: any[] = [];

    let page = 1;
    const PER_PAGE = 50;
    const MAX_PAGES = 10;
    let hasNextPage = true;

    while (hasNextPage) {
        if (signal?.aborted) {
            console.warn("Operation aborted by signal.");
            break;
        }

        if (page > MAX_PAGES) {
            console.warn(`Reached maximum safety pagination limit of ${MAX_PAGES} pages. Halting loop to prevent an infinite run.`);
            break;
        }

        const itemsResult = await client.callTool({
            name: "projects_list",
            arguments: {
                method: "list_project_items",
                owner: target.owner,
                project_number: target.projectNumber,
                page,
                per_page: PER_PAGE,
                fields: fieldIds
            }
        });

        const parsed = safeJsonParse(getMcpResponseText(itemsResult));
        const items = parsed.items ?? [];

        allItems.push(...items);

        if (items.length < PER_PAGE) {
            hasNextPage = false;
        } else {
            page++;
        }
    }

    const listEpics: boolean = route?.args?.listEpics === true;
    const epicSearch: string | null = route?.args?.epicSearch ?? null;
    const requestedFunction: string | null = route?.args?.function ?? null;
    const requestedIteration: string | undefined = route?.args?.iteration;

    if (listEpics) {
        return allItems.filter((item: any) => {
            if (!isEpicTypeItem(item)) return false;
            if (requestedFunction && !belongsToFunction(item, requestedFunction)) return false;
            if (!matchesLayoutFilter(item, layoutType, releaseColumn, requestedIteration)) return false;
            return true;
        });
    }

    if (epicSearch) {
        return allItems
            .filter((item: any) => {
                if (!matchesEpicSearch(item, epicSearch)) return false;
                if (requestedFunction && !belongsToFunction(item, requestedFunction)) return false;
                if (!matchesLayoutFilter(item, layoutType, releaseColumn, requestedIteration)) return false;
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
        if (!matchesLayoutFilter(item, layoutType, releaseColumn, requestedIteration)) return false;
        return true;
    });
}