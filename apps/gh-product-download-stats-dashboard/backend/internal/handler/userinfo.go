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

	"github.com/wso2-open-operations/engineering-tools/apps/gh-product-download-stats-dashboard/backend/internal/middleware"
)

// userInfoResponse is the caller's own identity and privileges.
type userInfoResponse struct {
	Email   string `json:"email"`
	IsAdmin bool   `json:"isAdmin"`
}

// UserInfo handles GET /api/v1/user-info — the signed-in caller's identity and
// privileges, with isAdmin computed server-side against ADMIN_GROUPS. This is
// what lets the webapp gate its Admin UI without ever knowing the admin group
// names (they live only in this backend's environment, not in the frontend's
// public config.js). Lives on AdminHandler because that's who owns adminGroups,
// but unlike the other methods it is NOT admin-gated: any authenticated user
// may ask "am I an admin?" — requireAdmin on the /admin endpoints remains the
// actual enforcement.
func (h *AdminHandler) UserInfo(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserInfoFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, ErrMsgUnauthorized)
		return
	}

	writeJSONValue(w, http.StatusOK, userInfoResponse{
		Email:   user.Email,
		IsAdmin: user.HasAnyGroup(h.adminGroups),
	})
}
