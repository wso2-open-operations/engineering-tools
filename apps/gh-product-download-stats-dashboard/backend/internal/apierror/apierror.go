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

// Package apierror defines a typed error returned by the data-store layer so
// handlers can map well-known failure modes (e.g. not-found) to appropriate HTTP
// responses without leaking storage details to the caller.
package apierror

import (
	"errors"
	"fmt"
)

// ErrNotFound is returned by the store when a requested row does not exist.
var ErrNotFound = errors.New("resource not found")

// Error wraps a storage failure with an HTTP-meaningful status code.
type Error struct {
	StatusCode int
	Message    string
}

func (e *Error) Error() string {
	return fmt.Sprintf("store error %d: %s", e.StatusCode, e.Message)
}
