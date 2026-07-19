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

function safeParse(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Invalid JSON");
  return JSON.parse(match[0]);
}

export async function routeIntent(anthropic: Anthropic, input: string, contextBoardName: string | null) {
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
2. Board Discovery Analysis: Check if the request explicitly designates a specific target board by name (e.g., "Digital Project Management Dashboard", "Platform Engineering").
3. Parameter Extraction Matrix:
   - "iteration": Capture window markers ("this_week", "next_week", "previous_week"). If the user mentions absolute time indicators like "last month" or custom intervals, output them verbatim. Default to "this_week".
   - "function": Extract team parameters ("IAM", "People Operations"). If missing, return null.

Provide output matching this strict schema structure:
{
  "status": "READY" | "REQUIRES_BOARD_SELECTION",
  "extractedBoardName": string | null,
  "args": {
    "iteration": string,
    "function": string | null
  },
  "conversationalResponse": string | null
}

Behavior States:
- If context board parameter is "NONE" and user input doesn't mention a distinct board name, flag status as "REQUIRES_BOARD_SELECTION".
- If the text specifies tracking layout options or answers confirmation selections, populate target fields cleanly.
`,
    messages: [{ role: "user", content: input }]
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text : "";
  return safeParse(text);
}