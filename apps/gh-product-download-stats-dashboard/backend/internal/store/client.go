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

// Package store is the MySQL data-access layer for the github_statistics
// database. It owns the connection pool and all read/write queries used by the
// dashboard handlers — mirroring the upstream-client pattern, with MySQL as the
// upstream instead of an HTTP service.
package store

import (
	"database/sql"
	"fmt"
	"net"
	"strconv"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Config holds the MySQL connection settings.
type Config struct {
	Host            string
	Port            int
	User            string
	Password        string
	Database        string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

// Store wraps the database connection pool.
type Store struct {
	db *sql.DB
}

// New opens a connection pool to MySQL using the given config. The pool is
// validated with a Ping before returning.
func New(cfg Config) (*Store, error) {
	dsn := mysql.Config{
		User:                 cfg.User,
		Passwd:               cfg.Password,
		Net:                  "tcp",
		Addr:                 net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		DBName:               cfg.Database,
		ParseTime:            true,
		Loc:                  time.UTC,
		AllowNativePasswords: true,
		Params:               map[string]string{"charset": "utf8mb4"},
	}

	db, err := sql.Open("mysql", dsn.FormatDSN())
	if err != nil {
		return nil, fmt.Errorf("store: open db: %w", err)
	}

	if cfg.MaxOpenConns > 0 {
		db.SetMaxOpenConns(cfg.MaxOpenConns)
	}
	if cfg.MaxIdleConns > 0 {
		db.SetMaxIdleConns(cfg.MaxIdleConns)
	}
	if cfg.ConnMaxLifetime > 0 {
		db.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	}

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: ping db: %w", err)
	}

	return &Store{db: db}, nil
}

// Close releases the underlying connection pool.
func (s *Store) Close() error {
	return s.db.Close()
}

const dateLayout = "2006-01-02"

// formatDate renders a DATE/DATETIME value as YYYY-MM-DD.
func formatDate(t time.Time) string {
	return t.Format(dateLayout)
}

// formatDateTime renders a DATETIME value as RFC3339.
func formatDateTime(t time.Time) string {
	return t.Format(time.RFC3339)
}
