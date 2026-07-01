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

package store

import (
	"encoding/json"
	"strings"
)

// parseAssetPrefixes decodes the asset_prefixes JSON column into a string slice.
// A null/empty/invalid value yields an empty (non-nil) slice.
func parseAssetPrefixes(raw []byte) []string {
	out := []string{}
	if len(raw) == 0 {
		return out
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return out
	}
	return values
}

// encodeAssetPrefixes marshals a string slice into a JSON value for storage.
// A nil slice is stored as an empty JSON array.
func encodeAssetPrefixes(prefixes []string) ([]byte, error) {
	if prefixes == nil {
		prefixes = []string{}
	}
	return json.Marshal(prefixes)
}

// repoIDPlaceholders builds a "?, ?, ?" fragment and the matching args slice for
// an IN clause. Returns ("", nil) when ids is empty so callers can omit the filter.
func repoIDPlaceholders(ids []int) (string, []any) {
	if len(ids) == 0 {
		return "", nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	return strings.Join(placeholders, ", "), args
}
