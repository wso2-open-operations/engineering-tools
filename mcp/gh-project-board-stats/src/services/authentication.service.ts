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

import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

export interface AuthenticatedUser {
    githubId: string;
    email: string;
}

const choreoJwksUri = process.env.CHOREO_JWKS_URI ?? "https://sts.choreo.dev/oauth2/jwks";

const asgardeoJwksUri = process.env.ASGARDEO_JWKS_URI ?? "https://api.asgardeo.io/t/wso2/oauth2/jwks";

const jwksUri = process.env.AUTH_ISSUER === "asgardeo" ? asgardeoJwksUri : choreoJwksUri;

const client = jwksClient({
    jwksUri,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 600000
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
    client.getSigningKey(header.kid!, (err, key) => {
        if (err || !key) {
            callback(err ?? new Error("Signing key not found"));
            return;
        }

        callback(null, key.getPublicKey());
    });
}

export async function authenticateRequest(jwtAssertion: string): Promise<AuthenticatedUser | null> {
    return new Promise((resolve) => {
        jwt.verify(jwtAssertion, getKey, { algorithms: ["RS256"] }, (err, decoded: any) => {
            if (err || !decoded) {
                console.error("JWT signature verification failed:", err?.message);
                return resolve(null);
            }

            if (!decoded.exp) {
                console.error("Token is missing an expiration ('exp') claim, rejecting.");
                return resolve(null);
            }

            const githubId = decoded.github_id || decoded.sub;
            const email = decoded.email;

            if (!githubId || !email) {
                console.error("Token is missing required claims (github_id/sub or email).");
                return resolve(null);
            }

            resolve({
                githubId: String(githubId).trim(),
                email: String(email).trim()
            });
        });
    });
}
