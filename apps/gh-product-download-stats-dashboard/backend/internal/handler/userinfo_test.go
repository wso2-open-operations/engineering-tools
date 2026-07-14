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

package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUserInfoRequiresAuth(t *testing.T) {
	h := NewAdminHandler(&mockStore{}, adminGroups())
	r := httptest.NewRequest(http.MethodGet, "/api/v1/user-info", nil)
	w := httptest.NewRecorder()

	h.UserInfo(w, r)

	assertStatus(t, w, http.StatusUnauthorized)
	assertErrorMessage(t, w, ErrMsgUnauthorized)
}

func TestUserInfoAdmin(t *testing.T) {
	h := NewAdminHandler(&mockStore{}, adminGroups())
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/user-info", nil), testAdmin)
	w := httptest.NewRecorder()

	h.UserInfo(w, r)

	assertStatus(t, w, http.StatusOK)
	body := decodeJSON[userInfoResponse](t, w)
	if body.Email != testAdmin.Email {
		t.Errorf("email = %q, want %q", body.Email, testAdmin.Email)
	}
	if !body.IsAdmin {
		t.Error("isAdmin = false, want true for a user in the admin group")
	}
}

func TestUserInfoNonAdmin(t *testing.T) {
	h := NewAdminHandler(&mockStore{}, adminGroups())
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/user-info", nil), testUser)
	w := httptest.NewRecorder()

	h.UserInfo(w, r)

	assertStatus(t, w, http.StatusOK)
	body := decodeJSON[userInfoResponse](t, w)
	if body.Email != testUser.Email {
		t.Errorf("email = %q, want %q", body.Email, testUser.Email)
	}
	if body.IsAdmin {
		t.Error("isAdmin = true, want false for a user outside the admin group")
	}
}

// TestUserInfoNoAdminGroupsConfigured pins the fail-closed behavior: with
// ADMIN_GROUPS unset, nobody is an admin.
func TestUserInfoNoAdminGroupsConfigured(t *testing.T) {
	h := NewAdminHandler(&mockStore{}, nil)
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/v1/user-info", nil), testAdmin)
	w := httptest.NewRecorder()

	h.UserInfo(w, r)

	assertStatus(t, w, http.StatusOK)
	if body := decodeJSON[userInfoResponse](t, w); body.IsAdmin {
		t.Error("isAdmin = true, want false when no admin groups are configured")
	}
}
