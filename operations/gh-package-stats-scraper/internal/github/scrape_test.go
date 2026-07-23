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
	"os"
	"testing"
	"time"
)

// The golden fixtures are real pages saved from github.com
// (openchoreo/openchoreo's "controller" container package). When GitHub
// changes its markup, refresh them:
//
//	curl -A "Mozilla/5.0" "https://github.com/openchoreo/openchoreo/pkgs/container/controller" \
//	  -o testdata/package_page.html
//	curl -A "Mozilla/5.0" "https://github.com/openchoreo/openchoreo/pkgs/container/controller/versions?filters%5Bversion_type%5D=tagged" \
//	  -o testdata/versions_page_tagged.html

func TestParsePackageTotalFixture(t *testing.T) {
	body, err := os.ReadFile("testdata/package_page.html")
	if err != nil {
		t.Fatal(err)
	}
	total, err := parsePackageTotal(body)
	if err != nil {
		t.Fatal(err)
	}
	// The fixture was saved when the exact total was 51,098. The invariant
	// that matters: an exact (non-rounded) positive value from the title attr.
	if total != 51098 {
		t.Errorf("total = %d, want 51098 (the fixture's exact title-attr value)", total)
	}
}

func TestParsePackageTotalFailsLoudlyOnWrongPage(t *testing.T) {
	if _, err := parsePackageTotal([]byte("<html><body><p>hello</p></body></html>")); err == nil {
		t.Fatal("want an error for a page without a Total downloads section, got nil")
	}
}

func TestParsePackageTotalFailsLoudlyWhenTitleAttrMissing(t *testing.T) {
	// Label present, exact value gone: the dangerous case — must be an error,
	// never a parsed 0 or the rounded text.
	page := []byte(`<html><body><div>
		<span class="d-block">Total downloads</span>
		<h3>51.1K</h3>
	</div></body></html>`)
	if _, err := parsePackageTotal(page); err == nil {
		t.Fatal("want an error when the h3 title attribute is missing, got nil")
	}
}

func TestParseVersionRowsFixture(t *testing.T) {
	body, err := os.ReadFile("testdata/versions_page_tagged.html")
	if err != nil {
		t.Fatal(err)
	}
	rows, hasMarkup, err := parseVersionRows(body)
	if err != nil {
		t.Fatal(err)
	}
	if !hasMarkup {
		t.Fatal("fixture has version rows, parser saw none")
	}
	if len(rows) != 50 {
		t.Fatalf("rows = %d, want 50 (a full tagged versions page)", len(rows))
	}
	tagged := 0
	for _, r := range rows {
		if r.VersionID == 0 {
			t.Errorf("row missing version id: %+v", r)
		}
		if r.Downloads < 0 {
			t.Errorf("row with negative downloads: %+v", r)
		}
		if len(r.Tags) > 0 {
			tagged++
		}
	}
	// The tagged filter was applied, so every row should carry >= 1 tag.
	if tagged != len(rows) {
		t.Errorf("rows with tags = %d, want all %d (tagged filter applied)", tagged, len(rows))
	}
	// Distinct identities.
	seen := map[int64]bool{}
	for _, r := range rows {
		if seen[r.VersionID] {
			t.Errorf("duplicate version id %d", r.VersionID)
		}
		seen[r.VersionID] = true
	}
}

func TestParseVersionRowsNoRowsIsNotAnError(t *testing.T) {
	rows, hasMarkup, err := parseVersionRows([]byte("<html><body><ul></ul></body></html>"))
	if err != nil {
		t.Fatal(err)
	}
	if hasMarkup || len(rows) != 0 {
		t.Fatalf("want no rows and no markup, got %d rows, markup=%v", len(rows), hasMarkup)
	}
}

func TestParseVersionRowsBrokenRowFailsLoudly(t *testing.T) {
	// A Box-row without a version-id link means markup drift: loud failure.
	page := []byte(`<html><body><ul>
		<li class="Box-row"><div>no links here</div></li>
	</ul></body></html>`)
	if _, _, err := parseVersionRows(page); err == nil {
		t.Fatal("want an error for an unparseable version row, got nil")
	}
}

// TestScraperWaitIsJittered pins that consecutive waits are NOT a fixed
// interval (the old time.Ticker behavior) and that every observed delay
// falls within [minDelay, minDelay+jitterRange).
func TestScraperWaitIsJittered(t *testing.T) {
	s := NewScraper(20*time.Millisecond, 30*time.Millisecond)
	ctx := context.Background()

	const samples = 12
	delays := make([]time.Duration, samples)
	for i := range samples {
		start := time.Now()
		if err := s.wait(ctx); err != nil {
			t.Fatal(err)
		}
		delays[i] = time.Since(start)
	}

	distinct := map[time.Duration]bool{}
	for i, d := range delays {
		if d < 20*time.Millisecond || d > 60*time.Millisecond {
			t.Errorf("delay[%d] = %v, want within [20ms, 60ms] (min 20ms + up to 30ms jitter, generous margin for scheduling)", i, d)
		}
		distinct[d.Round(time.Millisecond)] = true
	}
	if len(distinct) < 2 {
		t.Errorf("all %d observed delays rounded to the same value — jitter isn't varying: %v", samples, delays)
	}
}

// TestScraperWaitRespectsContextCancellation ensures a canceled context
// interrupts the wait immediately rather than blocking for the full delay.
func TestScraperWaitRespectsContextCancellation(t *testing.T) {
	s := NewScraper(time.Hour, 0)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	err := s.wait(ctx)
	if err == nil {
		t.Fatal("want an error from a canceled context, got nil")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("wait took %v after immediate cancellation, want near-instant return", elapsed)
	}
}

// TestLiveScrape validates the parsers against TODAY'S real github.com markup
// (fixtures can go stale silently). Guarded: only runs with RUN_LIVE=1.
func TestLiveScrape(t *testing.T) {
	if os.Getenv("RUN_LIVE") != "1" {
		t.Skip("set RUN_LIVE=1 to scrape live github.com")
	}
	s := NewScraper(1000*time.Millisecond, 600*time.Millisecond)
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	total, err := s.FetchPackageTotal(ctx, "openchoreo", "openchoreo", "controller")
	if err != nil {
		t.Fatalf("live package total: %v", err)
	}
	if total < 50000 { // was 51,098 at fixture time; totals only grow
		t.Errorf("live total = %d, implausibly low", total)
	}
	t.Logf("live exact total for controller: %d", total)

	rows, err := s.FetchTaggedVersions(ctx, "openchoreo", "openchoreo", "controller", 1)
	if err != nil {
		t.Fatalf("live versions: %v", err)
	}
	if len(rows) == 0 {
		t.Fatal("live versions: no rows parsed")
	}
	t.Logf("live tagged versions parsed: %d (first: id=%d tags=%v downloads=%d)",
		len(rows), rows[0].VersionID, rows[0].Tags, rows[0].Downloads)
}
