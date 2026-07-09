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

import process from "process";
import {
    getIterationValue,
    isMatchingIteration
} from "../services/iteration.service";
import { getFieldId } from "../services/projectField.service";
import { isRelease, belongsToFunction }
    from "../services/release.service";

export async function runTool(client: any, route: any) {
    const personalOwner = process.env.GITHUB_OWNER ?? process.env.USER ?? process.env.LOGNAME;
    if (!personalOwner) throw new Error("Missing GITHUB_OWNER (or USER/LOGNAME) env var");

    const personalProjectNumber = Number(process.env.PROJECT_ID);
    if (!Number.isFinite(personalProjectNumber)) {
        throw new Error("Missing or invalid PROJECT_ID env var");
    }

    const fieldsResult = await client.callTool({
        name: "projects_list",
        arguments: {
            method: "list_project_fields",
            owner: personalOwner,
            project_number: personalProjectNumber
        }
    });

    const fieldsText =
        fieldsResult.content
            ?.map((c: any) => c.text)
            .join("\n") ?? "";

    const projectFields = JSON.parse(fieldsText);

    const iterationFieldId =
        getFieldId(
            projectFields.fields,
            "Iteration"
        );

    const result = await client.callTool({
        name: "projects_list",
        arguments: {
            method: "list_project_items",
            owner: personalOwner,
            project_number: personalProjectNumber,
            per_page: 50,
            fields: [iterationFieldId]
        }
    });


    const text = result.content?.map((c: any) => c.text).join("\n") ?? "";
    if (!text) throw new Error("No data returned from MCP");

    const rawData = JSON.parse(text);
    const items = rawData.items ?? [];

    const releases = items.filter(
        (item: any) => {

            const iteration =
                getIterationValue(item);


            return (
                isMatchingIteration(iteration, route?.args?.iteration)
                &&
                isRelease(item)
                &&
                (
                    !route?.args?.function ||
                    belongsToFunction(
                        item,
                        route.args.function
                    )
                )
            );
        }
    );

    return releases;
}
