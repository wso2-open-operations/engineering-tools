import { dbPool } from "../database/mysql";

export interface UserRecord {
    githubId: string;
    email: string;
}


export async function getUser(
    githubId: string
): Promise<UserRecord | null> {

    const [rows]: any = await dbPool.execute(
        `SELECT github_id, email FROM ghs_users WHERE github_id = ?`,
        [githubId]
    );

    if (!rows.length) {
        return null;
    }

    return {
        githubId: rows[0].github_id,
        email: rows[0].email
    };
}

export async function updateUserEmail(githubId: string, email: string): Promise<void> {

    await dbPool.execute(
        `UPDATE ghs_users SET email = ? WHERE github_id = ?`,
        [email, githubId]
    );
}

export async function createUser(githubId: string, email: string): Promise<void> {

    await dbPool.execute(
        ` INSERT INTO ghs_users (github_id, email)VALUES (?, ?)`,
        [githubId, email]
    );
}

// Checks if the given email is already associated with a different GitHub ID
async function emailBelongsToAnotherUser(githubId: string, email: string): Promise<boolean> {

    const [rows]: any = await dbPool.execute(
        ` SELECT github_id FROM ghs_users WHERE email = ?`,
        [email]
    );

    if (!rows.length) {
        return false;
    }

    return rows[0].github_id !== githubId;
}

export async function ensureUserExists(githubId: string, email: string): Promise<void> {

    const existing = await getUser(githubId);

    if (existing) {
        if (existing.email !== email) {
            await updateUserEmail(githubId, email);
        }
        return;
    }

    try {
        await createUser(githubId, email);
    } catch (err: any) {
        if (err.code !== "ER_DUP_ENTRY") {
            throw err;
        }
        const duplicate = await emailBelongsToAnotherUser(githubId, email);

        if (duplicate) {
            throw new Error("EMAIL_ALREADY_LINKED");
        }

        const existingAfterRace = await getUser(githubId);
        if (!existingAfterRace) {
            throw err;
        }
        if (existingAfterRace.email !== email) {
            await updateUserEmail(githubId, email);
        }
    }
}