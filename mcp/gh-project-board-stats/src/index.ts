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

import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

import { connectMCP } from "./tools/mcpClient";
import { routeIntent } from "./agent/routeIntent";
import { runTool } from "./tools/runTool";

function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
): Promise<T> {
    let timeout: NodeJS.Timeout;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
            reject(new Error("Request timed out"));
        }, timeoutMs);
    });

    return Promise.race([
        promise.finally(() => clearTimeout(timeout)),
        timeoutPromise
    ]);
}

async function main() {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("Missing ANTHROPIC_API_KEY environment variable");
    }
    const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
    });

    const client = await connectMCP();

    const app = express();

    app.use(express.json({
        limit: "10kb"
    }));

    app.get("/health", (_req, res) => {
        res.json({
            status: "UP"
        });
    });

    app.post("/query", async (req, res) => {

        try {

            const question = req.body?.question;

            if (typeof question !== "string" || !question.trim()) {
                return res.status(400).json({
                    error: "Missing or invalid question"
                });
            }

            console.log("Question:", question);

            const intent =
                await withTimeout(
                    routeIntent(
                        anthropic,
                        question
                    ),
                    30000
                );

            const releases =
                await withTimeout(
                    runTool(
                        client,
                        intent
                    ),
                    30000
                );

            return res.json({
                count: releases.length,
                releases: releases.map(
                    (release: any) => release.content.title
                )
            });

        } catch (error: any) {
            console.error(error);

            if (error.message === "Request timed out") {
                return res.status(504).json({
                    error: "Request timed out"
                });
            }

            return res.status(500).json({
                error: "Internal server error"
            });
        }
    });

    const port =
        Number(process.env.PORT) || 8080;

    app.listen(port, () => {
        console.log(
            `GitHub Project Board Stats Service listening on port ${port}`
        );
    });
}

main().catch(console.error);