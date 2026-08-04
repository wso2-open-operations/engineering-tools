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

import { dbPool } from "../database/mysql";

export interface UserSession {
    githubId: string;
    activeBoardName: string | null;
    activeProjectId: number | null;
}

export interface SavedBoard {
    projectId: number;
    boardName: string;
    organizationName: string;
}

function truncate(value: string | null | undefined, maxLength = 255): string | null {
    if (!value) {
        return null;
    }

    const trimmed = value.trim();

    if (!trimmed.length) {
        return null;
    }

    return trimmed.slice(0, maxLength);
}

export async function getUserSession(githubId: string): Promise<UserSession | null> {

    const [rows]: any = await dbPool.execute(
        ` SELECT active_board_name, active_project_id FROM ghs_user_session_state  WHERE github_id = ? `,
        [githubId]
    );

    if (!rows.length) {
        return null;
    }

    return {
        githubId,
        activeBoardName: rows[0].active_board_name,
        activeProjectId: rows[0].active_project_id
    };
}

export async function setActiveBoard(
    githubId: string,
    boardName: string,
    projectId: number,
    organization: string
): Promise<void> {

    const safeBoard = truncate(boardName);

    await dbPool.execute(
        `
        INSERT INTO ghs_user_session_state
        (
            github_id,
            active_board_name,
            active_project_id
        )
        VALUES (?, ?, ?)

        ON DUPLICATE KEY UPDATE
            active_board_name = VALUES(active_board_name),
            active_project_id = VALUES(active_project_id)
        `,
        [
            githubId,
            safeBoard,
            projectId
        ]
    );

    await dbPool.execute(
        `
        INSERT INTO ghs_user_project_preferences
        (
            github_id,
            project_id,
            organization_name,
            board_name,
            is_remembered
        )
        VALUES (?, ?, ?, ?, 1)

        ON DUPLICATE KEY UPDATE

            board_name = VALUES(board_name),
            organization_name = VALUES(organization_name),
            last_accessed_at = CURRENT_TIMESTAMP
        `,
        [
            githubId,
            projectId,
            organization,
            safeBoard
        ]
    );
}

export async function clearActiveBoard(
    githubId: string
): Promise<void> {

    await dbPool.execute(
        `
        DELETE FROM ghs_user_session_state
        WHERE github_id = ?
        `,
        [githubId]
    );
}

export async function getSavedBoards(
    githubId: string
): Promise<SavedBoard[]> {

    const [rows]: any = await dbPool.execute(
        `
        SELECT
            project_id,
            board_name,
            organization_name

        FROM ghs_user_project_preferences

        WHERE
            github_id = ?
            AND is_remembered = 1

        ORDER BY last_accessed_at DESC
        `,
        [githubId]
    );

    return rows.map((row: any) => ({
        projectId: row.project_id,
        boardName: row.board_name,
        organizationName: row.organization_name
    }));
}