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
import { isRelease, belongsToFunction } from "../services/release.service";
import { dbPool } from "../database/mysql";

interface RuntimeTarget {
    owner: string;
    projectNumber: number;
}

function getMcpResponseText(result: any): string {
    if (!result || !result.content || !Array.isArray(result.content)) {
        return "";
    }
    return result.content
        .filter((c: any) => c && c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
}

function safeJsonParse(rawText: string): any {
    const trimmed = rawText.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        throw new Error(`Invalid non-JSON diagnostic payload returned from MCP backend: ${trimmed.slice(0, 150)}`);
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
        "SELECT layout_type, release_column_name FROM project_board_metadata WHERE project_id = ?",
        [target.projectNumber]
    );

    let layoutType = "ITERATION_BASED";
    let fallbackColumn = "Done";

    if (metaRows.length > 0) {
        layoutType = metaRows[0].layout_type;
        fallbackColumn = metaRows[0].release_column_name;
    }

    const fieldsResult = await client.callTool({
        name: "projects_list",
        arguments: {
            method: "list_project_fields",
            owner: target.owner,
            project_number: target.projectNumber
        }
    }, { signal });

    const fieldsText = getMcpResponseText(fieldsResult);
    const projectFields = safeJsonParse(fieldsText);
    const activeFieldIds: string[] = [];

    if (layoutType === "ITERATION_BASED") {
        const iterationFieldId = getFieldId(projectFields.fields, "Iteration");
        if (iterationFieldId) activeFieldIds.push(iterationFieldId);
    } else {
        const statusFieldId = getFieldId(projectFields.fields, "Status");
        if (statusFieldId) activeFieldIds.push(statusFieldId);
    }

    if (route?.args?.function) {
        const functionFieldId = getFieldId(projectFields.fields, "Function");
        if (functionFieldId) activeFieldIds.push(functionFieldId);
    }
    let targetItems: any[] = [];
    let hasNextPage = true;
    let currentPage = 1;
    const itemsPerPage = 50;
    const MAX_PAGES = 10;

    while (hasNextPage) {
        if (currentPage > MAX_PAGES) {
            console.warn(`runTool: Reached maximum safety limit of ${MAX_PAGES} pages. Halting pagination.`);
            break;
        }
        const result = await client.callTool({
            name: "projects_list",
            arguments: {
                method: "list_project_items",
                owner: target.owner,
                project_number: target.projectNumber,
                per_page: itemsPerPage,
                page: currentPage,
                fields: activeFieldIds
            }
        }, { signal });

        const text = getMcpResponseText(result);
        const rawData = safeJsonParse(text);
        const items = rawData.items ?? [];

        targetItems.push(...items);

        if (items.length < itemsPerPage) {
            hasNextPage = false;
        } else {
            currentPage++;
        }
    }

    return targetItems.filter((item: any) => {
        if (!isRelease(item)) return false;

        if (route?.args?.function && !belongsToFunction(item, route.args.function)) {
            return false;
        }

        if (layoutType === "ITERATION_BASED") {
            const iteration = getIterationValue(item);
            return isMatchingIteration(iteration, route?.args?.iteration);
        } else {
            const statusValue = item.fields?.find((f: any) => f.name.toLowerCase() === "status")?.value;
            return String(statusValue).toLowerCase() === fallbackColumn.toLowerCase();
        }
    });
}