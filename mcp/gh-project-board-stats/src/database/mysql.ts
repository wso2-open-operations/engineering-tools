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

import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'github_stats_db'
};

export let dbPool: mysql.Pool;

export async function initializeDatabase() {
  if (process.env.RUN_MIGRATIONS === 'true') {
    const connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password
    });

    await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`;`);
    await connection.end();
  }

  dbPool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  if (process.env.RUN_MIGRATIONS === 'true') {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ghs_users (
        github_id VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL,
        encrypted_access_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (github_id),
        UNIQUE KEY uk_email (email)
      );
    `);

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ghs_project_board_metadata (
        project_id INT PRIMARY KEY,
        layout_type ENUM('ITERATION_BASED', 'FLAT_KANBAN') DEFAULT 'ITERATION_BASED',
        release_column_name VARCHAR(100) DEFAULT 'Done'
      );
    `);

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ghs_user_session_state (
        github_id VARCHAR(100) PRIMARY KEY,
        current_state VARCHAR(50) NOT NULL,
        pending_board_name VARCHAR(150),
        pending_iteration VARCHAR(50),
        pending_function VARCHAR(100)
      );
    `);

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ghs_user_project_preferences (
        github_id VARCHAR(100) NOT NULL,
        project_id INT NOT NULL,
        organization_name VARCHAR(100) NOT NULL,
        board_name VARCHAR(150) NOT NULL,
        is_remembered TINYINT(1) DEFAULT 0,
        PRIMARY KEY (github_id, project_id)
      );
    `);

    console.log("Database structural tables checked/initialized with ghs_ prefix.");
  }

  console.log(`Database connection pool initialized successfully for database: ${dbConfig.database}`);
}