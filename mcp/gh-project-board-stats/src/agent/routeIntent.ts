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
  status: "READY" | "REQUIRES_BOARD_SELECTION";
  extractedBoardName: string | null;
  isSwitchingBoard: boolean;
  args: {
    iteration: string | null;
    function: string | null;
    epicSearch: string | null;
    listEpics: boolean;
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
      iteration: recoveredIteration,
      function: null,
      epicSearch: null,
      listEpics: false
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
      "status" in parsed &&
      "args" in parsed &&
      typeof (parsed as Record<string, unknown>).args === "object" &&
      (parsed as Record<string, unknown>).args !== null
    ) {
      const obj = parsed as Record<string, unknown>;

      if (obj.status !== "READY" && obj.status !== "REQUIRES_BOARD_SELECTION") {
        console.warn(`Invalid status value "${String(obj.status)}" returned from LLM. Falling back.`);
        return fallback;
      }

      const typedParsed = parsed as RoutedIntent;

      if (typeof typedParsed.isSwitchingBoard !== "boolean") {
        typedParsed.isSwitchingBoard = false;
      }
      if (!typedParsed.args.iteration && recoveredIteration) {
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
You are an advanced project board routing coordinator. You evaluate user intentions and translate conversational requests into explicit processing targets.

Active Context Parameter:
- Mapped Target Project Board: ${contextBoardName ?? "NONE (Unknown)"}

Return ONLY a single valid JSON object. Do not wrap code in text formatting blocks.

Output Response Struct Evaluation Rules:
1. Target Action Logic:
   - Check if the user is explicitly requesting to switch/change boards or list available project boards (e.g., "switch board", "change project", "select another board", "show all boards"). Set "isSwitchingBoard": true in this case.
2. Board Discovery Analysis:
   - Check if the user input contains a partial or full board name to search for (e.g., "wso2 digital", "Platform Engineering").
   - Extract the exact search term in "extractedBoardName".
3. Parameter Extraction Matrix:
   - "iteration": Map natural time expressions into standard keys:
     - Current period ("this week", "current sprint", "now", "today", "active iteration") -> "this_week"
     - Next period ("next week", "upcoming sprint", "next release", "coming up") -> "next_week"
     - Past period ("last week", "previous sprint", "past iteration", "completed") -> "previous_week"
     If an explicit named sprint or month is mentioned, output that exact string verbatim. Default to "this_week".
   - "function": Extract team or domain parameters (e.g., "IAM", "People Operations"). If missing, return null.
   - "epicSearch": Extract the target epic term when asked about an epic or feature group.
   - "listEpics": Set to true ONLY if asking to list Epics. Otherwise false.

Provide output matching this strict schema structure:
{
  "status": "READY" | "REQUIRES_BOARD_SELECTION",
  "extractedBoardName": string | null,
  "isSwitchingBoard": boolean,
  "args": {
    "iteration": string | null,
    "function": string | null,
    "epicSearch": string | null,
    "listEpics": boolean
  },
  "conversationalResponse": string | null
}

Behavior States:
- If context board parameter is "NONE" and user input doesn't mention a board name, set status to "REQUIRES_BOARD_SELECTION".
- If user input asks to switch boards, set "isSwitchingBoard": true.
`,
    messages: [{ role: "user", content: input }]
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text : "";
  return safeParse(text, input);
}