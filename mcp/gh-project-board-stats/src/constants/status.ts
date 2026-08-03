export const ITEM_STATUS = {
    DONE: "done",
    IN_PROGRESS: "in_progress",
    TESTING: "testing",
    TODO: "todo"
} as const;

export type ItemStatus =
    typeof ITEM_STATUS[keyof typeof ITEM_STATUS];


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