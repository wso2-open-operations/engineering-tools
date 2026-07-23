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

package github

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

// samplePAT stands in for the real classic token — these tests prove the
// whole discovery path (auth header, query params, pagination, decoding)
// without any credential or network access, using the JSON fixtures in
// testdata/ that mirror GitHub's documented org-packages response shape.
const samplePAT = "ghp_SAMPLE_TOKEN_FOR_TESTS_ONLY"

// newMockGitHubAPI serves the two org_packages fixture pages and records
// every request for assertions.
func newMockGitHubAPI(t *testing.T) (*httptest.Server, *[]*http.Request) {
	t.Helper()
	var seen []*http.Request
	mux := http.NewServeMux()
	mux.HandleFunc("GET /orgs/thunder-id/packages", func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Clone(context.Background()))

		if got := r.Header.Get("Authorization"); got != "Bearer "+samplePAT {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"message":"Requires authentication"}`))
			return
		}
		if got := r.URL.Query().Get("package_type"); got != "container" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"message":"package_type is required"}`))
			return
		}

		var fixture string
		switch r.URL.Query().Get("page") {
		case "1":
			fixture = "testdata/org_packages_page1.json"
		case "2":
			fixture = "testdata/org_packages_page2.json"
		default:
			_, _ = w.Write([]byte("[]"))
			return
		}
		body, err := os.ReadFile(fixture)
		if err != nil {
			t.Errorf("read fixture %s: %v", fixture, err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, &seen
}

// testAPIClient returns a client pointed at the mock server, with pageSize 2
// so the 2-item page1 fixture reads as "full page, keep going" and the 1-item
// page2 as "short page, stop".
func testAPIClient(baseURL string) *APIClient {
	return &APIClient{
		httpClient: &http.Client{Timeout: 5 * time.Second},
		token:      samplePAT,
		baseURL:    baseURL,
		pageSize:   2,
	}
}

func TestListOrgContainerPackagesWithSampleResponses(t *testing.T) {
	srv, seen := newMockGitHubAPI(t)
	c := testAPIClient(srv.URL)

	packages, err := c.ListOrgContainerPackages(context.Background(), "thunder-id")
	if err != nil {
		t.Fatal(err)
	}

	// Pagination: full page 1 (2 items) then short page 2 (1 item) → 3 total,
	// exactly 2 requests.
	if len(packages) != 3 {
		t.Fatalf("packages = %d, want 3 across both fixture pages", len(packages))
	}
	if len(*seen) != 2 {
		t.Fatalf("requests = %d, want 2 (short page must stop pagination)", len(*seen))
	}

	// Decoding, including the slashed package name.
	if packages[0].Name != "thunderid" || packages[0].ID != 5512877 || packages[0].VersionCount != 34 {
		t.Errorf("package[0] = %+v, want thunderid/5512877/34 versions", packages[0])
	}
	if packages[1].Name != "helm-charts/thunderid" {
		t.Errorf("package[1].Name = %q, want the slashed name preserved", packages[1].Name)
	}

	// Repository linkage: present on the first two, absent on the third —
	// the nil case is what keeps unlinked packages out of the scrape set.
	if packages[0].Repository == nil || packages[0].Repository.Name != "thunderid" {
		t.Errorf("package[0].Repository = %+v, want linkage to thunderid", packages[0].Repository)
	}
	if packages[2].Repository != nil {
		t.Errorf("package[2].Repository = %+v, want nil for an unlinked package", packages[2].Repository)
	}
}

func TestListOrgContainerPackagesSendsAuthAndParams(t *testing.T) {
	srv, seen := newMockGitHubAPI(t)
	c := testAPIClient(srv.URL)

	if _, err := c.ListOrgContainerPackages(context.Background(), "thunder-id"); err != nil {
		t.Fatal(err)
	}
	first := (*seen)[0]
	if got := first.Header.Get("Authorization"); got != "Bearer "+samplePAT {
		t.Errorf("Authorization = %q, want the sample PAT as a Bearer token", got)
	}
	if got := first.Header.Get("X-GitHub-Api-Version"); got != "2022-11-28" {
		t.Errorf("X-GitHub-Api-Version = %q, want 2022-11-28", got)
	}
	q := first.URL.Query()
	if q.Get("package_type") != "container" || q.Get("per_page") != "2" || q.Get("page") != "1" {
		t.Errorf("query = %v, want package_type=container&per_page=2&page=1", q)
	}
}

func TestListOrgContainerPackagesRejectedToken(t *testing.T) {
	srv, _ := newMockGitHubAPI(t)
	c := testAPIClient(srv.URL)
	c.token = "ghp_WRONG"

	_, err := c.ListOrgContainerPackages(context.Background(), "thunder-id")
	if err == nil {
		t.Fatal("want an error for a rejected token, got nil")
	}
}
