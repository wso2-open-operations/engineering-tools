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
import type { RoutedIntent } from "../types/intent";

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

      if (
        obj.status !== "READY" &&
        obj.status !== "REQUIRES_BOARD_SELECTION" &&
        obj.status !== "UNSUPPORTED"
      ) {
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
You are an advanced project board routing coordinator for GitHub Project Boards. You evaluate user input, extract filter parameters, identify target project boards, and handle unsupported requests.

Active Context Parameter:
- Currently Selected Board: ${contextBoardName ?? "NONE (Unknown)"}

Capabilities Supported By This System:
1. Viewing releases, features, or items scheduled for an iteration/timeframe (e.g., "this week", "next sprint", "previous iteration").
2. Filtering items by team/function/domain (e.g., "Sales", "People Operations", "Engineering").
3. Listing high-level epics or features (e.g., "show epics", "list features", "show feature list").
4. Searching for items under a specific feature or epic name (e.g., "tasks in User Auth epic", "items under Payment feature").
5. Filtering items by execution status (e.g., "what's done", "show completed items", "what is in progress").
6. Switching or querying any project board in the organization.

Return ONLY a single valid JSON object. Do not wrap code in text formatting blocks.

Classification Rules:
1. Unsupported / Off-topic Requests:
- If the user asks something completely outside project board capabilities (e.g., "write python code", "delete an issue", "create a repository"), set status to "UNSUPPORTED" and provide a polite explanation in "conversationalResponse". Set all "args" properties to null/false: { "iteration": null, "function": null, "epicSearch": null, "listEpics": false, "status": null }.

2. Board Switch Request & Keyword Selection:
- Explicit Switch: If user explicitly asks to change, switch, open, or list boards (e.g., "switch board to IAM", "open DevPortal", "go to HIPAA"), set "isSwitchingBoard": true and populate "extractedBoardName".
- Bare Board Term: If the user enters a board target term without explicit item query filters (e.g., "HIPAA 2026", "WSO2 Digital", "APIP Cloud"), treat it as a BOARD SWITCH/SELECTION request: set "isSwitchingBoard": true and "extractedBoardName" to the extracted term.

3. Project Board Query:
- If user input relates to project board items, epics, features, releases, or iterations:
  - If a specific target board name is mentioned or referenced inside the query (e.g., "show releases on WSO2 Digital", "what is done in DevPortal?"), populate "extractedBoardName" with the extracted board term.
  - If no board name is mentioned and "Currently Selected Board" is active, set status to "READY" and run the query on the current board.
  - If no board name is mentioned and "Currently Selected Board" is "NONE (Unknown)", set status to "REQUIRES_BOARD_SELECTION".

4. CRITICAL — Extracted Board Target Cleaning Rules:
- Extract ONLY the core identifier keyword or title phrase into "extractedBoardName".
- Strip away conversational wrapper words: "board", "boards", "project", "projects", "team", "related", "related to", "show me", "open", "switch to", "regarding", "for", "the", "in", "about".

Parameter Extraction Matrix (for "READY" queries):
- "status": Normalize to one of ['done', 'in_progress', 'testing', 'todo'] if explicitly asked. Otherwise null.
- "listEpics": Set true when the user asks to LIST high-level Epics or Features (e.g., "list epics", "show epics", "list features", "show features", "get all epics"). Default false.
- "epicSearch": Extracted feature or epic target name string if searching for items WITHIN/UNDER a specific feature or epic (e.g., "tasks in User Auth", "items under Payment feature"). Otherwise null.
- "function": Functional team/department filter ONLY if it is a department or team name (e.g., "Sales", "Engineering", "People Ops"). Do NOT map feature/epic names here.
- "iteration": Set to "this_week", "next_week", "previous_week", or exact string if specified.

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