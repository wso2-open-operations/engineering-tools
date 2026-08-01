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

      if (obj.status !== "READY" && obj.status !== "REQUIRES_BOARD_SELECTION" && obj.status !== "UNSUPPORTED") {
        console.warn(`Invalid status value "${String(obj.status)}" returned from LLM. Falling back.`);
        return fallback;
      }

      const typedParsed = parsed as RoutedIntent;

      if (typeof typedParsed.isSwitchingBoard !== "boolean") {
        typedParsed.isSwitchingBoard = false;
      }
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
2. Filtering items by team/function/domain (e.g., "IAM", "People Operations", "Engineering").
3. Listing epics or features (e.g., "show epics", "list features").
4. Searching for items under a specific feature or epic name (e.g., "tasks in User Auth epic").
5. Switching or listing available project boards.

Return ONLY a single valid JSON object. Do not wrap code in text formatting blocks.

Classification Rules:
1. Unsupported / Off-topic Requests:
   - If the user asks something completely outside project board capabilities (e.g., "write python code", "what is the weather", "delete an issue", "create a repository"), set status to "UNSUPPORTED" and provide a polite explanation in "conversationalResponse" stating what you can and cannot do. Set all "args" to null / false.
2. Board Switch Request:
   - If user asks to change or list boards, set "isSwitchingBoard": true.
3. Project Board Query:
   - If user input relates to project board items, epics, features, releases, or iterations, set status to "READY" (or "REQUIRES_BOARD_SELECTION" if no active board is selected and no board name is given).

Parameter Extraction Matrix (for "READY" queries):
- General principle: the person asking may phrase things in any way — different words, casual or formal tone, typos, indirect phrasing. Always classify by the underlying MEANING of what they're asking for, never by matching against specific example wording. The examples throughout this prompt are illustrations of a rule, not an exhaustive list of recognized phrases — generalize the rule itself to any input with equivalent meaning.
- "listEpics": In this system, "Epics" and "Features/Releases" are DIFFERENT, OPPOSING item types — an Epic is a grouping container; a Feature/Release is a regular shippable item that may belong under one.
  - Set true ONLY when the user explicitly wants to see items that ARE Epics themselves: "show me the epics", "what epics do we have", "list epics", "epic list", "items labeled Type/Epic".
  - The word "feature(s)" on its own means the OPPOSITE — it refers to regular release items, NOT epics. Do not set listEpics true just because "feature" appears in the sentence.
  - If the user explicitly contrasts the two — e.g., "features not epics", "features, not the epics", "show features instead of epics" — this is an unambiguous override: listEpics MUST be false, no matter what other words appear.
  - When genuinely ambiguous, default to false (features/releases is the default query type; epics are the explicit, opt-in case).
  - Worked examples:
    - "give me this week's features on People Operations" -> listEpics: false, function: "People Operations", iteration: "this_week"
    - "i want features not the epics" -> listEpics: false
    - "show me all epics" -> listEpics: true
    - "what epics do we have in Engineering" -> listEpics: true, function: "Engineering"
- "epicSearch": Target feature/epic name string if searching within a specific epic. Otherwise null.
- "function": Team, domain, or component parameter (e.g., "IAM", "Frontend"). Otherwise null.
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
    "listEpics": boolean
  },
  "conversationalResponse": string | null
}
`,
    messages: [{ role: "user", content: input }]
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text : "";
  return safeParse(text, input);
}