/**
 * Mock for expo-sqlite
 * Provides in-memory SQLite database for testing
 */

class MockDatabase {
  constructor(dbName) {
    this.dbName = dbName;
    this.tables = {};
    this.queryLog = [];
    this.data = {};
    this.transactionActive = false;
  }

  // Async methods (used by Store.ts)
  async execAsync(sql, params = []) {
    this.queryLog.push({ sql, params, method: 'execAsync' });
    const trimmedSql = sql.trim().toUpperCase();

    if (trimmedSql.startsWith('PRAGMA')) {
      return null;
    }

    if (trimmedSql.startsWith('BEGIN')) {
      this.transactionActive = true;
      return null;
    }

    if (trimmedSql.startsWith('COMMIT')) {
      this.transactionActive = false;
      return null;
    }

    if (trimmedSql.startsWith('ROLLBACK')) {
      this.transactionActive = false;
      return null;
    }

    if (trimmedSql.startsWith('CREATE')) {
      return null;
    }

    if (trimmedSql.startsWith('DROP')) {
      const match = sql.match(/DROP TABLE IF EXISTS (\w+)/i);
      if (match) {
        delete this.tables[match[1]];
      }
      return null;
    }

    return null;
  }

  async runAsync(sql, params = []) {
    this.queryLog.push({ sql, params, method: 'runAsync' });
    const trimmedSql = sql.trim().toUpperCase();

    if (trimmedSql.startsWith('INSERT') || trimmedSql.startsWith('UPDATE') || trimmedSql.startsWith('DELETE')) {
      return { changes: 1, lastInsertRowid: Math.random() };
    }

    return { changes: 0 };
  }

  async getAllAsync(sql, params = []) {
    this.queryLog.push({ sql, params, method: 'getAllAsync' });
    return this.data.allResults || [];
  }

  async getFirstAsync(sql, params = []) {
    this.queryLog.push({ sql, params, method: 'getFirstAsync' });
    const results = this.data.firstResults;
    return results && results.length > 0 ? results[0] : null;
  }

  async closeAsync() {
    this.tables = {};
  }

  // Sync methods (legacy support)
  execSync(sql, params = []) {
    this.queryLog.push({ sql, params, method: 'execSync' });
    // Simple parser for basic SQL
    const trimmedSql = sql.trim().toUpperCase();

    if (trimmedSql.startsWith('CREATE TABLE')) {
      // Just track that table was created
      return null;
    }

    if (trimmedSql.startsWith('DROP TABLE')) {
      const match = sql.match(/DROP TABLE IF EXISTS (\w+)/i);
      if (match) {
        delete this.tables[match[1]];
      }
      return null;
    }

    return null;
  }

  runSync(sql, params = []) {
    this.queryLog.push({ sql, params, method: 'runSync' });

    const trimmedSql = sql.trim().toUpperCase();

    if (trimmedSql.startsWith('INSERT')) {
      return { changes: 1, lastInsertRowid: Math.random() };
    }

    if (trimmedSql.startsWith('UPDATE')) {
      return { changes: 1 };
    }

    if (trimmedSql.startsWith('DELETE')) {
      return { changes: 0 };
    }

    return { changes: 0 };
  }

  getAllSync(sql, params = []) {
    this.queryLog.push({ sql, params, method: 'getAllSync' });

    const trimmedSql = sql.trim().toUpperCase();

    if (trimmedSql.startsWith('SELECT')) {
      // Return empty results for testing
      return [];
    }

    return [];
  }

  getFirstSync(sql, params = []) {
    const results = this.getAllSync(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  closeSync() {
    this.tables = {};
  }

  // Test utilities
  getQueryLog() {
    return this.queryLog;
  }

  clearQueryLog() {
    this.queryLog = [];
  }

  setMockData(data) {
    this.data = data;
  }

  __reset__() {
    this.tables = {};
    this.queryLog = [];
    this.data = {};
    this.transactionActive = false;
  }
}

const openDatabases = {};

module.exports = {
  openDatabaseSync: jest.fn((dbName) => {
    if (!openDatabases[dbName]) {
      openDatabases[dbName] = new MockDatabase(dbName);
    }
    return openDatabases[dbName];
  }),

  deleteDatabaseAsync: jest.fn(async (dbName) => {
    if (openDatabases[dbName]) {
      delete openDatabases[dbName];
    }
    return Promise.resolve();
  }),

  // Utility functions for testing
  __getDatabaseSync: jest.fn((dbName) => {
    return openDatabases[dbName] || null;
  }),

  __clearAllDatabases: jest.fn(() => {
    Object.keys(openDatabases).forEach((key) => {
      delete openDatabases[key];
    });
  }),

  __setDatabaseData: jest.fn((dbName, data) => {
    if (!openDatabases[dbName]) {
      openDatabases[dbName] = new MockDatabase(dbName);
    }
    openDatabases[dbName].data = data;
  }),

  SQLiteDatabase: MockDatabase,
};
