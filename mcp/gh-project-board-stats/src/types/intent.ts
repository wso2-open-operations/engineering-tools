export type IntentStatus =
    | "READY"
    | "REQUIRES_BOARD_SELECTION"
    | "UNSUPPORTED";

export interface IntentArgs {
    iteration: string | null;
    function: string | null;
    epicSearch: string | null;
    listEpics: boolean;
    status: string | null;
}

export interface RoutedIntent {
    status: IntentStatus;
    extractedBoardName: string | null;
    isSwitchingBoard: boolean;
    args: IntentArgs;
    conversationalResponse: string | null;
    rawInput?: string;
}