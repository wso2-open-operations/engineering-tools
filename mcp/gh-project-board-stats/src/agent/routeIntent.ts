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
  args: {
    iteration: string | null;
    function: string | null;
  };
  conversationalResponse: string | null;
  rawInput?: string;
}

function detectIterationFromRawInput(rawInput: string): string | null {
  if (/next\s*week/i.test(rawInput)) return "next_week";
  if (/last\s*week|previous\s*week/i.test(rawInput)) return "previous_week";
  if (/this\s*week/i.test(rawInput)) return "this_week";
  return null;
}

function safeParse(text: string, rawInput: string): RoutedIntent {
  const recoveredIteration = detectIterationFromRawInput(rawInput);

  const fallback: RoutedIntent = {
    status: "REQUIRES_BOARD_SELECTION",
    extractedBoardName: null,
    args: {
      iteration: recoveredIteration,
      function: null
    },
    conversationalResponse: "I couldn't quite process that request. Which project board would you like to view?",
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

      if (!typedParsed.args.iteration && recoveredIteration) {
        typedParsed.args.iteration = recoveredIteration;
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
1. Target Action Logic: Determine if the user is asking to extract release metrics/timeline statistics, or providing confirmation details to initialize a board.
2. Board Discovery Analysis: Check if the request explicitly designates a specific target board by name (e.g., "Digital Project Management Dashboard", "Platform Engineering") or if they want to SWITCH boards (e.g., "change board", "switch project", "look at another board").
3. Parameter Extraction Matrix:
   - "iteration": Capture window markers ("this_week", "next_week", "previous_week"). If the user mentions absolute time indicators like "last month" or custom intervals, output them verbatim. Default to "this_week".
   - "function": Extract team parameters ("IAM", "People Operations"). If missing, return null.

Provide output matching this strict schema structure:
{
  "status": "READY" | "REQUIRES_BOARD_SELECTION",
  "extractedBoardName": string | null,
  "args": {
    "iteration": string | null,
    "function": string | null
  },
  "conversationalResponse": string | null
}

Behavior States:
- If context board parameter is "NONE" and user input doesn't mention a distinct board name, flag status as "REQUIRES_BOARD_SELECTION".
- CRITICAL OVERRIDE: If the user explicitly asks to "switch boards", "change project", or names a completely different board than the active context board "${contextBoardName}", set status to "REQUIRES_BOARD_SELECTION" and extract the new board name if provided.
`,
    messages: [{ role: "user", content: input }]
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text : "";
  return safeParse(text, input);
}