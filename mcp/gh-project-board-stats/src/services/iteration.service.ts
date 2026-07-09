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

    return getProjectFieldValue(
        item,
        "Iteration"
    );
}

export function isCurrentIteration(
    iteration: any
) {

    if (!iteration) {
        return false;
    }

    const today = new Date();

    const start = new Date(
        iteration.start_date
    );

    const end = new Date(start);

    end.setDate(
        start.getDate() + iteration.duration - 1
    );


    return (
        today >= start &&
        today <= end
    );
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

        const today = new Date();

        const start = new Date(
            iteration.start_date
        );

        return start > today;
    }


    return false;
}