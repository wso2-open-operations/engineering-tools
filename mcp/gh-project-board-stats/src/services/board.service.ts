import { RoutedIntent } from "../types/intent";

export interface BoardCandidate {
    number: number;
    title: string;
    confident: boolean;
}

export interface BoardResolution {
    type: "FOUND" | "NONE" | "MULTIPLE";
    board?: BoardCandidate;
    boards?: BoardCandidate[];
}

interface CachedBoards {
    timestamp: number;
    boards: Array<{ number: number; title: string }>;
}

const BOARDS_CACHE = new Map<string, CachedBoards>();
const CACHE_TTL_MS = 5 * 60 * 1000;

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

function dedupeBoards<T extends { number: number }>(boards: T[]): T[] {
    const map = new Map<number, T>();
    for (const board of boards) {
        if (!map.has(board.number)) {
            map.set(board.number, board);
        }
    }
    return Array.from(map.values());
}

export async function getBoards(
    client: any,
    owner: string,
    signal?: AbortSignal,
    forceRefresh = false
): Promise<Array<{ number: number; title: string }>> {
    const now = Date.now();
    const cached = BOARDS_CACHE.get(owner);

    if (!forceRefresh && cached && now - cached.timestamp < CACHE_TTL_MS) {
        return cached.boards;
    }

    const allProjects: any[] = [];
    let hasNextPage = true;
    let endCursor: string | null = null;
    let pageCount = 0;
    const MAX_PAGES = 10;

    while (hasNextPage && pageCount < MAX_PAGES) {
        if (signal?.aborted) {
            console.warn("Operation aborted by signal.");
            break;
        }

        const args: Record<string, any> = {
            method: "list_projects",
            owner,
            first: 100
        };

        if (endCursor) {
            args.after = endCursor;
        }

        try {
            const result = await client.callTool(
                {
                    name: "projects_list",
                    arguments: args
                },
                undefined,
                { signal }
            );

            const parsed = safeJsonParse(getMcpResponseText(result));
            const projects = Array.isArray(parsed)
                ? parsed
                : parsed.projects ?? parsed.nodes ?? [];

            allProjects.push(...projects);

            const pageInfo = parsed.pageInfo ?? parsed.page_info;
            const nextCursor = pageInfo?.endCursor ?? pageInfo?.nextCursor ?? null;

            if (
                pageInfo &&
                pageInfo.hasNextPage &&
                nextCursor &&
                nextCursor !== endCursor
            ) {
                hasNextPage = pageInfo.hasNextPage;
                endCursor = nextCursor;
            } else {
                hasNextPage = false;
            }

            if (Array.isArray(parsed) || !pageInfo) {
                break;
            }

            pageCount++;
        } catch (err: any) {
            if (err instanceof TypeError && err.message.includes("v3Schema")) {
                try {
                    const fallbackResult = await client.callTool({
                        name: "projects_list",
                        arguments: args
                    });
                    const parsed = safeJsonParse(getMcpResponseText(fallbackResult));
                    const projects = Array.isArray(parsed) ? parsed : parsed.projects ?? parsed.nodes ?? [];
                    allProjects.push(...projects);
                    break;
                } catch (retryErr) {
                    console.error("Retry failed:", retryErr);
                }
            }
            if (allProjects.length > 0) break;
            throw err;
        }
    }

    const deduped = dedupeBoards(
        allProjects.map((p: any) => ({
            number: p.number,
            title: p.title
        }))
    );

    if (deduped.length > 0) {
        BOARDS_CACHE.set(owner, { timestamp: now, boards: deduped });
    }

    return deduped;
}

export async function findMatchingBoards(
    client: any,
    owner: string,
    keyword: string,
    signal?: AbortSignal
): Promise<BoardCandidate[]> {
    const boards = await getBoards(client, owner, signal);
    const rawSearch = keyword.trim().toLowerCase();

    if (!rawSearch) return [];

    const exactMatches = boards.filter(
        (b) => b.title.toLowerCase() === rawSearch
    );
    if (exactMatches.length === 1) {
        return exactMatches.map((b) => ({ ...b, confident: true }));
    }

    const searchTokens = rawSearch
        .split(/\s+/)
        .filter((t) => t.length > 1 && !["board", "project", "the", "for", "in"].includes(t));

    const tokenMatches = boards.filter((board) => {
        const titleLower = board.title.toLowerCase();
        return searchTokens.every((token) => titleLower.includes(token));
    });

    if (tokenMatches.length > 0) {
        return dedupeBoards(tokenMatches.map((b) => ({ ...b, confident: true })));
    }

    const partialMatches = boards.filter((board) => {
        const titleLower = board.title.toLowerCase();
        return searchTokens.some((token) => titleLower.includes(token));
    });

    return dedupeBoards(partialMatches.map((b) => ({ ...b, confident: false })));
}

export async function resolveBoard(
    client: any,
    owner: string,
    keyword: string,
    signal?: AbortSignal
): Promise<BoardResolution> {
    const matches = await findMatchingBoards(client, owner, keyword, signal);

    if (matches.length === 0) {
        return { type: "NONE" };
    }

    if (matches.length === 1) {
        return {
            type: "FOUND",
            board: matches[0]
        };
    }

    return {
        type: "MULTIPLE",
        boards: matches
    };
}

export function requiresBoardLookup(intent: RoutedIntent): boolean {
    return Boolean(intent.extractedBoardName);
}