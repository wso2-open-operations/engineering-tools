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
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
)

// Download counts for container packages exist NOWHERE in GitHub's APIs —
// only on the public github.com package pages. These parsers read exactly two
// things from the HTML:
//
//  1. The package page's exact all-time total. The visible text is rounded
//     ("51.1K"), but the element carries the exact value in its title
//     attribute: <h3 title="51098">51.1K</h3>, directly following a
//     "Total downloads" label.
//  2. Version rows on the /versions page (tagged filter): each li.Box-row
//     links to /orgs/{org}/packages/container/{name}/{versionID}, carries
//     ?tag= parameters for its tags, and shows an exact integer count next
//     to a "Version downloads" screen-reader label.
//
// Every parser fails LOUDLY when the expected structure is absent: a page
// that fetches fine but parses to nothing means GitHub changed its markup,
// and that must surface as an error — never as a silent zero (the clone-
// traffic lesson).

// scrapeUserAgent identifies us politely; GitHub serves these pages to any
// browser without auth.
const scrapeUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

// VersionRow is one tagged version scraped from a package's versions page.
type VersionRow struct {
	VersionID int64
	Tags      []string
	Downloads int64
}

// Scraper fetches and parses github.com package pages, waiting a randomized
// delay before each request so a nightly run never resembles a bot burst. The
// randomization (not a fixed tick) is deliberate: a perfectly uniform fetch
// cadence is itself a signal bot/abuse detection can key off, on top of just
// being polite about request volume.
type Scraper struct {
	httpClient  *http.Client
	minDelay    time.Duration
	jitterRange time.Duration
}

// NewScraper creates a Scraper that waits a randomized duration in
// [minDelay, minDelay+jitterRange) before every request attempt.
func NewScraper(minDelay, jitterRange time.Duration) *Scraper {
	return &Scraper{
		httpClient:  &http.Client{Timeout: 30 * time.Second},
		minDelay:    minDelay,
		jitterRange: jitterRange,
	}
}

// Close is currently a no-op — kept so callers can unconditionally `defer
// scraper.Close()` even as internals change (e.g. if a connection pool or
// background goroutine is added later).
func (s *Scraper) Close() {}

// wait blocks for the randomized inter-request delay, or returns early with
// ctx's error if it's canceled first.
func (s *Scraper) wait(ctx context.Context) error {
	delay := s.minDelay
	if s.jitterRange > 0 {
		delay += rand.N(s.jitterRange)
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// packagePageURL returns the package landing page URL. Package names can
// contain slashes (e.g. "helm-charts/thunderid") which must be %2F-encoded.
func packagePageURL(org, repo, pkg string) string {
	return fmt.Sprintf("https://github.com/%s/%s/pkgs/container/%s",
		org, repo, url.PathEscape(pkg))
}

// versionsPageURL returns page n of the package's TAGGED versions listing.
func versionsPageURL(org, repo, pkg string, page int) string {
	return fmt.Sprintf("https://github.com/%s/%s/pkgs/container/%s/versions?filters%%5Bversion_type%%5D=tagged&page=%d",
		org, repo, url.PathEscape(pkg), page)
}

// fetch GETs a page (throttled, with one retry on transient failure).
func (s *Scraper) fetch(ctx context.Context, pageURL string) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if err := s.wait(ctx); err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
		if err != nil {
			return nil, fmt.Errorf("scrape: build request: %w", err)
		}
		req.Header.Set("User-Agent", scrapeUserAgent)
		req.Header.Set("Accept", "text/html")

		resp, err := s.httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
		closeErr := resp.Body.Close()
		if err != nil || closeErr != nil {
			lastErr = fmt.Errorf("read body: %v / close: %v", err, closeErr)
			continue
		}
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
			// 404 won't heal on retry (package removed / renamed).
			if resp.StatusCode == http.StatusNotFound {
				return nil, fmt.Errorf("scrape: %s: %w", pageURL, lastErr)
			}
			continue
		}
		return body, nil
	}
	return nil, fmt.Errorf("scrape: %s: %w", pageURL, lastErr)
}

// FetchPackageTotal returns the package's exact all-time download total from
// its landing page.
func (s *Scraper) FetchPackageTotal(ctx context.Context, org, repo, pkg string) (int64, error) {
	body, err := s.fetch(ctx, packagePageURL(org, repo, pkg))
	if err != nil {
		return 0, err
	}
	total, err := parsePackageTotal(body)
	if err != nil {
		return 0, fmt.Errorf("package %s/%s/%s: %w", org, repo, pkg, err)
	}
	return total, nil
}

// FetchTaggedVersions returns the tagged-version rows from the first
// maxPages pages of the package's versions listing, newest first. Stops
// early on a short page.
func (s *Scraper) FetchTaggedVersions(ctx context.Context, org, repo, pkg string, maxPages int) ([]VersionRow, error) {
	var all []VersionRow
	for page := 1; page <= maxPages; page++ {
		body, err := s.fetch(ctx, versionsPageURL(org, repo, pkg, page))
		if err != nil {
			return nil, err
		}
		rows, hasRowMarkup, err := parseVersionRows(body)
		if err != nil {
			return nil, fmt.Errorf("package %s/%s/%s versions page %d: %w", org, repo, pkg, page, err)
		}
		// A page with no row markup at all past page 1 just means we ran out
		// of versions; on page 1 it is only legitimate for a package with no
		// tagged versions, which parseVersionRows distinguishes via markup.
		if !hasRowMarkup && page > 1 {
			break
		}
		all = append(all, rows...)
		if len(rows) < versionsPageSize {
			break
		}
	}
	return all, nil
}

// versionsPageSize is how many rows GitHub renders per versions page.
const versionsPageSize = 50

var versionHrefRe = regexp.MustCompile(`^/orgs/[^/]+/packages/container/.+/(\d+)(?:\?|$)`)

// parsePackageTotal extracts the exact total from the "Total downloads"
// sidebar: <span>Total downloads</span> ... <h3 title="51098">51.1K</h3>.
func parsePackageTotal(body []byte) (int64, error) {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return 0, fmt.Errorf("parse html: %w", err)
	}

	var total int64 = -1
	var sawLabel bool
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if total >= 0 {
			return
		}
		if n.Type == html.ElementNode && n.Data == "span" &&
			strings.TrimSpace(textContent(n)) == "Total downloads" {
			sawLabel = true
			// The exact value is the title attribute of the h3 sibling that
			// follows the label span.
			for sib := n.NextSibling; sib != nil; sib = sib.NextSibling {
				if sib.Type == html.ElementNode && sib.Data == "h3" {
					if v, ok := parseIntAttr(sib, "title"); ok {
						total = v
					}
					return
				}
			}
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	if total < 0 {
		if sawLabel {
			return 0, fmt.Errorf("found the Total downloads label but no exact count in the h3 title attribute — GitHub markup changed")
		}
		return 0, fmt.Errorf("no Total downloads section found — GitHub markup changed or wrong page")
	}
	return total, nil
}

// parseVersionRows extracts tagged-version rows from a versions page. The
// second return reports whether any li.Box-row version markup was present at
// all, letting callers distinguish "no versions" from "not a versions page".
func parseVersionRows(body []byte) ([]VersionRow, bool, error) {
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return nil, false, fmt.Errorf("parse html: %w", err)
	}

	var rows []VersionRow
	hasRowMarkup := false
	var brokenRows int

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "li" && hasClass(n, "Box-row") {
			hasRowMarkup = true
			row, ok := parseVersionRow(n)
			if ok {
				rows = append(rows, row)
			} else {
				brokenRows++
			}
			return // rows don't nest
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	// Rows that exist but don't parse mean partial markup drift — that must
	// fail loudly rather than silently under-count.
	if brokenRows > 0 {
		return nil, hasRowMarkup, fmt.Errorf("%d of %d version rows failed to parse — GitHub markup changed",
			brokenRows, brokenRows+len(rows))
	}
	return rows, hasRowMarkup, nil
}

// parseVersionRow pulls the version ID, tags, and exact download count out of
// one li.Box-row node.
func parseVersionRow(row *html.Node) (VersionRow, bool) {
	var out VersionRow
	seenTags := map[string]bool{}

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "a" {
			if href, ok := attr(n, "href"); ok {
				if m := versionHrefRe.FindStringSubmatch(href); m != nil && out.VersionID == 0 {
					if id, err := strconv.ParseInt(m[1], 10, 64); err == nil {
						out.VersionID = id
					}
				}
				if u, err := url.Parse(href); err == nil {
					if tag := u.Query().Get("tag"); tag != "" && !seenTags[tag] {
						seenTags[tag] = true
						out.Tags = append(out.Tags, tag)
					}
				}
			}
		}
		// The count is the text just before <span class="sr-only">Version downloads</span>.
		if n.Type == html.ElementNode && n.Data == "span" && hasClass(n, "sr-only") &&
			strings.TrimSpace(textContent(n)) == "Version downloads" {
			for sib := n.PrevSibling; sib != nil; sib = sib.PrevSibling {
				text := strings.TrimSpace(nodeText(sib))
				if text == "" {
					continue
				}
				if v, err := strconv.ParseInt(strings.ReplaceAll(text, ",", ""), 10, 64); err == nil {
					out.Downloads = v
				}
				break
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(row)

	// A row is only valid with an identity; count 0 is legitimate, but a
	// missing ID means the row structure changed.
	return out, out.VersionID != 0
}

// ----- small html.Node helpers -----

func attr(n *html.Node, name string) (string, bool) {
	for _, a := range n.Attr {
		if a.Key == name {
			return a.Val, true
		}
	}
	return "", false
}

func parseIntAttr(n *html.Node, name string) (int64, bool) {
	v, ok := attr(n, name)
	if !ok {
		return 0, false
	}
	parsed, err := strconv.ParseInt(strings.ReplaceAll(strings.TrimSpace(v), ",", ""), 10, 64)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func hasClass(n *html.Node, class string) bool {
	v, ok := attr(n, "class")
	if !ok {
		return false
	}
	for _, c := range strings.Fields(v) {
		if c == class {
			return true
		}
	}
	return false
}

// textContent returns the concatenated text of a node's subtree.
func textContent(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}

// nodeText returns a node's own text (for text nodes) or subtree text.
func nodeText(n *html.Node) string {
	if n.Type == html.TextNode {
		return n.Data
	}
	return textContent(n)
}
