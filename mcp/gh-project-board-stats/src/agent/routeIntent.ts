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

import Anthropic from "@anthropic-ai/sdk";

export interface RoutedIntent {
  status: "READY" | "REQUIRES_BOARD_SELECTION" | "UNSUPPORTED";
  extractedBoardName: string | null;
  isSwitchingBoard: boolean;
  args: {
    iteration: string | null;
    function: string | null;
    epicSearch: string | null;
    listEpics: boolean;
    status: string | null;
  };
  conversationalResponse: string | null;
  rawInput?: string;
}

function detectIterationFromRawInput(rawInput: string): string | null {
  if (/next\s*(week|sprint|iteration)/i.test(rawInput)) return "next_week";
  if (/last\s*(week|sprint|iteration)|previous\s*(week|sprint|iteration)/i.test(rawInput)) return "previous_week";
  if (/this\s*(week|sprint|iteration)|current\s*(sprint|iteration)/i.test(rawInput)) return "this_week";
  return null;
}

function safeParse(text: string, rawInput: string): RoutedIntent {
  const recoveredIteration = detectIterationFromRawInput(rawInput);

  const fallback: RoutedIntent = {
    status: "REQUIRES_BOARD_SELECTION",
    extractedBoardName: null,
    isSwitchingBoard: false,
    args: {
      iteration: null,
      function: null,
      epicSearch: null,
      listEpics: false,
      status: null
    },
    conversationalResponse: "Which project board would you like to view?",
    rawInput
  };

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const rawTextToParse = match ? match[0] : text;
    const parsed: unknown = JSON.parse(rawTextToParse);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      "status" in parsed
    ) {
      const obj = parsed as Record<string, unknown>;

      if (obj.status !== "READY" && obj.status !== "REQUIRES_BOARD_SELECTION" && obj.status !== "UNSUPPORTED") {
        console.warn(`Invalid status value "${String(obj.status)}" returned from LLM. Falling back.`);
        return fallback;
      }

      let argsObj = obj.args;
      if (typeof argsObj !== "object" || argsObj === null) {
        argsObj = {
          iteration: null,
          function: null,
          epicSearch: null,
          listEpics: false,
          status: null
        };
      }

      const typedParsed: RoutedIntent = {
        status: obj.status as RoutedIntent["status"],
        extractedBoardName: (obj.extractedBoardName as string) ?? null,
        isSwitchingBoard: Boolean(obj.isSwitchingBoard),
        args: argsObj as RoutedIntent["args"],
        conversationalResponse: (obj.conversationalResponse as string) ?? null,
        rawInput
      };

      if (!typedParsed.args.iteration && recoveredIteration && typedParsed.status === "READY") {
        typedParsed.args.iteration = recoveredIteration;
      }
      if (typeof typedParsed.args.function === "undefined") {
        typedParsed.args.function = null;
      }
      if (typeof typedParsed.args.epicSearch === "undefined") {
        typedParsed.args.epicSearch = null;
      }
      if (typeof typedParsed.args.listEpics !== "boolean") {
        typedParsed.args.listEpics = false;
      }
      if (typeof typedParsed.args.status === "undefined") {
        typedParsed.args.status = null;
      }

      return typedParsed;
    }

    console.warn("Parsed JSON did not match expected RoutedIntent object shape:", parsed);
    return fallback;
  } catch (err) {
    console.error("Failed to parse intent JSON from LLM output:", text, err);
    return fallback;
  }
}

export async function routeIntent(
  anthropic: Anthropic,
  input: string,
  contextBoardName: string | null
): Promise<RoutedIntent> {
  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    temperature: 0,
    system: `
You are an advanced project board routing coordinator for GitHub Project Boards. You evaluate user input and extract relevant filter parameters or handle unsupported requests.

Active Context Parameter:
- Currently Selected Board: ${contextBoardName ?? "NONE (Unknown)"}

Capabilities Supported By This System:
1. Viewing releases or items scheduled for an iteration/timeframe (e.g., "this week", "next sprint", "previous iteration").
2. Filtering items by team/function/domain (e.g., "Sales", "People Operations", "Engineering").
3. Listing epics or features (e.g., "show epics", "list features").
4. Searching for items under a specific feature or epic name (e.g., "tasks in User Auth epic").
5. Filtering items by execution status (e.g., "what's done", "show completed items", "what is in progress").
6. Switching or listing available project boards.

Return ONLY a single valid JSON object. Do not wrap code in text formatting blocks.

Classification Rules:
1. Unsupported / Off-topic Requests:
- If the user asks something completely outside project board capabilities (e.g., "write python code", "delete an issue", "create a repository"), set status to "UNSUPPORTED" and provide a polite explanation in "conversationalResponse" stating what you can and cannot do. Always return an "args" object where all property values are set to null/false: { "iteration": null, "function": null, "epicSearch": null, "listEpics": false, "status": null }.

2. Board Switch Request & Keyword Selection Precedence:
- Explicit Switch: If user explicitly asks to change, switch, open, or list boards (e.g., "switch board", "open wso2 digital", "change board to IAM"), set "isSwitchingBoard": true and populate "extractedBoardName" if a board target is given.
- Standalone Bare Keyword (No Active Board): If "Currently Selected Board" is "NONE (Unknown)" and the user types a single keyword or short term (e.g., "IAM", "wso2 digital"), treat it as a BOARD SWITCH request: set "isSwitchingBoard": true and "extractedBoardName": "<keyword>".
- Standalone Bare Keyword (Active Board Present): If "Currently Selected Board" is active AND the user enters a single keyword without switch action words (e.g., "Security", "Engineering"), treat it as a QUERY on the active board: set status to "READY", "isSwitchingBoard": false, and extract it into "args.function".

3. Project Board Query:
- If user input relates to project board items, epics, features, releases, or iterations, set status to "READY" (or "REQUIRES_BOARD_SELECTION" if no active board is selected and no board target/keyword is given).
- If they specify or mention a target board name directly inside a query (e.g., "show releases on WSO2 Digital"), populate "extractedBoardName".

Parameter Extraction Matrix (for "READY" queries):
- General principle: classify by the underlying MEANING of what they're asking for.
- "status": Normalize to one of ['done', 'in_progress', 'testing', 'todo'] if the user explicitly asks for items in a specific state. Otherwise set to null.
- "done": "completed", "done", "finished", "shipped", "released", "closed"
- "in_progress": "in progress", "wip", "ongoing", "doing", "currently being worked on", "in development"
- "testing": "in qa", "testing", "under review", "uat", "review"
- "todo": "to do", "not started", "open", "backlog", "planned"
- "listEpics": Set true ONLY when the user explicitly wants to see items that ARE Epics themselves. Default to false for regular features/releases.
- "epicSearch": Target feature/epic name string if searching within a specific epic. Otherwise null.
- "function": Team, domain, or component parameter (e.g., "Security", "People Operations"). Otherwise null.
- "iteration": Set to "this_week", "next_week", "previous_week", or exact string if specified. ONLY populate if user input relates to a timeframe or iteration query. Do NOT default to "this_week" for general questions.

Strict Output Schema:
{
"status": "READY" | "REQUIRES_BOARD_SELECTION" | "UNSUPPORTED",
"extractedBoardName": string | null,
"isSwitchingBoard": boolean,
"args": {
"iteration": string | null,
"function": string | null,
"epicSearch": string | null,
"listEpics": boolean,
"status": string | null
},
"conversationalResponse": string | null
}
`,
    messages: [{ role: "user", content: input }]
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text : "";
  return safeParse(text, input);
}