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

package middleware

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestExtractUserInfoAcceptsAnyConfiguredAudience(t *testing.T) {
	key := testKey(t)
	cfg := Config{
		Issuer:                "https://issuer.example",
		Audience:              "dashboard-client, one-wso2-client",
		TokenValidatorEnabled: true,
		ClockSkew:             time.Second,
	}
	keyFunc := func(*jwt.Token) (any, error) { return &key.PublicKey, nil }

	info, err := extractUserInfo(signToken(t, key, "one-wso2-client"), cfg, keyFunc)
	if err != nil {
		t.Fatalf("second configured audience: %v", err)
	}
	if info.UserID != "user-1" {
		t.Fatalf("user id = %q", info.UserID)
	}

	if _, err := extractUserInfo(signToken(t, key, "dashboard-client"), cfg, keyFunc); err != nil {
		t.Fatalf("first configured audience: %v", err)
	}

	if _, err := extractUserInfo(signToken(t, key, "other-client"), cfg, keyFunc); err == nil {
		t.Fatal("expected an audience outside the configured set to be rejected")
	}
}

func testKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return key
}

func signToken(t *testing.T, key *rsa.PrivateKey, audience string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"sub": "user-1",
		"iss": "https://issuer.example",
		"aud": audience,
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}
