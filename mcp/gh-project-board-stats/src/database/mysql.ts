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
      CREATE TABLE IF NOT EXISTS users (
        github_id VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL,
        encrypted_access_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (github_id),
        UNIQUE KEY uk_email (email)
      );
    `);

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS project_board_metadata (
        project_id INT PRIMARY KEY,
        layout_type ENUM('ITERATION_BASED', 'FLAT_KANBAN') DEFAULT 'ITERATION_BASED',
        release_column_name VARCHAR(100) DEFAULT 'Done'
      );
    `);

    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS user_session_state (
        github_id VARCHAR(100) PRIMARY KEY,
        current_state VARCHAR(50) NOT NULL,
        pending_board_name VARCHAR(150),
        pending_iteration VARCHAR(50),
        pending_function VARCHAR(100)
      );
    `);

    const [tableExists]: any = await dbPool.execute(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = ? AND table_name = 'user_project_preferences'
    `, [dbConfig.database]);

    if (tableExists[0].count > 0) {
      const [columns]: any = await dbPool.execute(`
        SHOW COLUMNS FROM user_project_preferences LIKE 'user_id'
      `);

      if (columns.length > 0) {
        try {
          const [sampleRows]: any = await dbPool.execute("SELECT user_id FROM user_project_preferences LIMIT 5");
          const requiresIdentityBackfill = sampleRows.some((row: any) => row.user_id.includes('@'));

          if (requiresIdentityBackfill) {
            await dbPool.execute(`
              UPDATE user_project_preferences upp
              JOIN users u ON upp.user_id = u.email
              SET upp.user_id = u.github_id
            `);
          }

          const [pkCheck]: any = await dbPool.execute(`
            SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE 
            WHERE table_schema = ? AND table_name = 'user_project_preferences' AND CONSTRAINT_NAME = 'PRIMARY'
          `, [dbConfig.database]);

          const structuralPkList = pkCheck.map((c: any) => c.COLUMN_NAME);

          if (structuralPkList.includes('user_id')) {
            await dbPool.execute("ALTER TABLE user_project_preferences DROP PRIMARY KEY");
          }

          await dbPool.execute("ALTER TABLE user_project_preferences CHANGE COLUMN user_id github_id VARCHAR(100) NOT NULL");
          await dbPool.execute("ALTER TABLE user_project_preferences ADD PRIMARY KEY (github_id, project_id)");

          console.log("Migration steps for user preference constraints successfully finalized.");
        } catch (migrationFatalError) {
          console.error("FATAL: Database schema migration failed down midway. Halting execution context to prevent structural data corruption:", migrationFatalError);
          process.exit(1);
        }
      }
    } else {
      await dbPool.execute(`
        CREATE TABLE IF NOT EXISTS user_project_preferences (
          github_id VARCHAR(100) NOT NULL,
          project_id INT NOT NULL,
          organization_name VARCHAR(100) NOT NULL,
          board_name VARCHAR(150) NOT NULL,
          is_remembered TINYINT(1) DEFAULT 0,
          PRIMARY KEY (github_id, project_id)
        );
      `);
    }

    console.log("Database structural tables checked/initialized.");
  }

  console.log(`Database connection pool initialized successfully for database: ${dbConfig.database}`);
}