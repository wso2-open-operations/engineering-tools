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

export async function runTool(client: any, route: any, target: RuntimeTarget) {

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
    });

    const fieldsText = fieldsResult.content?.map((c: any) => c.text).join("\n") ?? "";
    const projectFields = JSON.parse(fieldsText);

    let targetItems: any[] = [];

    if (layoutType === "ITERATION_BASED") {
        const iterationFieldId = getFieldId(projectFields.fields, "Iteration");

        const result = await client.callTool({
            name: "projects_list",
            arguments: {
                method: "list_project_items",
                owner: target.owner,
                project_number: target.projectNumber,
                per_page: 50,
                fields: [iterationFieldId]
            }
        });

        const text = result.content?.map((c: any) => c.text).join("\n") ?? "";
        const rawData = JSON.parse(text);
        targetItems = rawData.items ?? [];
    } else {

        const statusFieldId = getFieldId(projectFields.fields, "Status");

        const result = await client.callTool({
            name: "projects_list",
            arguments: {
                method: "list_project_items",
                owner: target.owner,
                project_number: target.projectNumber,
                per_page: 50,
                fields: [statusFieldId]
            }
        });

        const text = result.content?.map((c: any) => c.text).join("\n") ?? "";
        const rawData = JSON.parse(text);
        targetItems = rawData.items ?? [];
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