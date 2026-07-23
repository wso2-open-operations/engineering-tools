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

// Package github talks to GitHub for the two things this scraper needs:
//   - the REST API (classic PAT, read:packages) for package DISCOVERY —
//     which container packages exist in an org and which repository each
//     belongs to. No GitHub API exposes download counts.
//   - the public github.com HTML pages for the COUNTS (see scrape.go).
package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const defaultAPIBaseURL = "https://api.github.com"

// defaultAPIPageSize is GitHub's maximum page size for the packages listing.
const defaultAPIPageSize = 100

// maxAPIPages bounds discovery pagination so a misbehaving upstream can't
// wedge the run (100 pages x 100 packages is far beyond any real org).
const maxAPIPages = 100

// Package is the subset of GitHub's org-package object the scraper uses.
type Package struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	PackageType  string `json:"package_type"`
	VersionCount int    `json:"version_count"`
	Repository   *struct {
		Name string `json:"name"`
	} `json:"repository"`
}

// APIClient is a minimal GitHub REST client for package discovery.
type APIClient struct {
	httpClient *http.Client
	token      string
	// baseURL and pageSize default to the real GitHub API; tests point them
	// at an httptest server with small fixture pages (see api_test.go).
	baseURL  string
	pageSize int
}

// NewAPIClient creates a discovery client. token must be a classic PAT with
// the read:packages scope — GitHub's packages endpoints reject both anonymous
// calls and fine-grained PATs.
func NewAPIClient(token string) *APIClient {
	return &APIClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		token:      token,
		baseURL:    defaultAPIBaseURL,
		pageSize:   defaultAPIPageSize,
	}
}

// ListOrgContainerPackages returns every container package in the org,
// following pagination until a short page. Callers filter by repository —
// deliberately not done here, matching the org-level semantics of the API.
func (c *APIClient) ListOrgContainerPackages(ctx context.Context, org string) ([]Package, error) {
	var all []Package
	for page := 1; ; page++ {
		if page > maxAPIPages {
			return nil, fmt.Errorf("github api: org %s: exceeded %d discovery pages", org, maxAPIPages)
		}
		url := fmt.Sprintf("%s/orgs/%s/packages?package_type=container&per_page=%d&page=%d",
			c.baseURL, org, c.pageSize, page)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, fmt.Errorf("github api: build request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("github api: list packages for %s: %w", org, err)
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
		closeErr := resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("github api: read response for %s: %w", org, err)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("github api: close response for %s: %w", org, closeErr)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("github api: list packages for %s: HTTP %d: %.200s",
				org, resp.StatusCode, string(body))
		}

		var pagePackages []Package
		if err := json.Unmarshal(body, &pagePackages); err != nil {
			return nil, fmt.Errorf("github api: decode packages for %s: %w", org, err)
		}
		all = append(all, pagePackages...)
		if len(pagePackages) < c.pageSize {
			return all, nil
		}
	}
}
