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

export async function routeIntent(
  anthropic: Anthropic,
  input: string
) {
  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 150,
    temperature: 0,

    system: `
You are a routing assistant.

Return ONLY JSON.

Extract:
- iteration
- function

Rules:

1. If user mentions:
"this week"
"current iteration"

return:

{
  "args": {
    "iteration": "this_week",
    "function": null
  }
}


2. If user mentions:
"next week"

return:

{
  "args": {
    "iteration": "next_week",
    "function": null
  }
}


3. If user explicitly mentions a function/team such as:
"People Operations"
"IAM"

extract it.

Example:

User:
"What are releases this week in People Operations?"

Return:

{
  "args": {
    "iteration": "this_week",
    "function": "People Operations"
  }
}


Never invent a function.
If the user does not mention one, return null.
`,

    messages: [
      {
        role: "user",
        content: input
      }
    ]
  });

  const text =
    res.content[0]?.type === "text"
      ? res.content[0].text
      : "";

  return safeParse(text);
}