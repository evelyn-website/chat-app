import * as SQLite from "expo-sqlite";

import type { GroupRow, IStore, MessageRow, UserRow } from "./types";
import { Group, DbMessage, User } from "@/types/types";

export class Store implements IStore {
  private db: SQLite.SQLiteDatabase | null = null;
  private initPromise: Promise<void>;
  // Promise-based lock to serialize transaction-based operations
  private transactionLock: Promise<void> = Promise.resolve();
  private closed = false;

  constructor() {
    this.db = SQLite.openDatabaseSync("store.db");
    this.initPromise = this._initializeDatabase();
  }

  private async _initializeDatabase(): Promise<void> {
    if (!this.db) {
      throw new Error("Database not available for initialization.");
    }

    const TARGET_DATABASE_VERSION = 10;

    let { user_version: currentDbVersion } = (await this.db.getFirstAsync<{
      user_version: number;
    }>("PRAGMA user_version")) || { user_version: 0 };

    if (currentDbVersion >= TARGET_DATABASE_VERSION) {
      console.log(
        `Database is already at version ${currentDbVersion} (target: ${TARGET_DATABASE_VERSION}). No migration needed.`
      );
      return;
    }

    console.log(
      `Current DB version: ${currentDbVersion}, Target DB version: ${TARGET_DATABASE_VERSION}. Starting migration...`
    );

    if (currentDbVersion < 1) {
      console.log("Migrating to version 1...");
      await this.db.execAsync(`
      PRAGMA journal_mode = 'wal';
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT, 
        email TEXT, 
        created_at TEXT, 
        updated_at TEXT, 
        group_admin_map TEXT
      );
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY NOT NULL, 
        name TEXT, 
        admin BOOLEAN DEFAULT FALSE, 
        group_users TEXT NOT NULL DEFAULT '[]', 
        created_at TEXT, 
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL, 
        content TEXT NOT NULL, 
        user_id TEXT NOT NULL, 
        group_id TEXT NOT NULL, 
        timestamp TEXT NOT NULL, 
        FOREIGN KEY(group_id) REFERENCES groups(id), 
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);
      await this.db.execAsync(`PRAGMA user_version = 1`);
      currentDbVersion = 1;
      console.log("Successfully migrated to version 1.");
    }

    if (currentDbVersion === 1) {
      console.log("Migrating to version 2...");
      await this.db.execAsync(`
      ALTER TABLE groups ADD COLUMN start_time TEXT;
      ALTER TABLE groups ADD COLUMN end_time TEXT;
    `);
      await this.db.execAsync(`PRAGMA user_version = 2`);
      currentDbVersion = 2;
      console.log("Successfully migrated to version 2.");
    }

    if (currentDbVersion === 2) {
      console.log("Migrating to version 3...");
      await this.db.execAsync("BEGIN TRANSACTION;");
      try {
        await this.db.execAsync(
          "ALTER TABLE messages RENAME TO messages_old_v2;"
        );

        await this.db.execAsync(`
        CREATE TABLE messages (
          id TEXT PRIMARY KEY NOT NULL,
          content TEXT NOT NULL,
          user_id TEXT NOT NULL, 
          group_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );
      `);
        await this.db.execAsync(`
        INSERT INTO messages (id, content, user_id, group_id, timestamp)
        SELECT id, content, user_id, group_id, timestamp FROM messages_old_v2;
      `);
        await this.db.execAsync("DROP TABLE messages_old_v2;");
        await this.db.execAsync("COMMIT;");
        await this.db.execAsync(`PRAGMA user_version = 3`);
        currentDbVersion = 3;
        console.log("Successfully migrated to version 3.");
      } catch (e) {
        await this.db.execAsync("ROLLBACK;");
        console.error("Error migrating database to version 3:", e);
        throw e;
      }
    }

    if (currentDbVersion === 3) {
      console.log("Migrating to version 4...");
      await this.db.execAsync("BEGIN TRANSACTION;");
      try {
        await this.db.execAsync(`
        ALTER TABLE groups ADD COLUMN description TEXT;
        ALTER TABLE groups ADD COLUMN location TEXT;
        ALTER TABLE groups ADD COLUMN image_url TEXT;
      `);
        await this.db.execAsync("COMMIT;");
        await this.db.execAsync(`PRAGMA user_version = 4`);
        currentDbVersion = 4;
        console.log("Successfully migrated to version 4.");
      } catch (e) {
        await this.db.execAsync("ROLLBACK;");
        console.error("Error migrating database to version 4:", e);
        throw e;
      }
    }

    if (currentDbVersion === 4) {
      console.log("Migrating to version 5 (E2EE Setup)...");
      await this.db.execAsync("BEGIN TRANSACTION;");
      try {
        await this.db.execAsync(
          "ALTER TABLE messages RENAME TO messages_old_v4;"
        );

        await this.db.execAsync(`
        CREATE TABLE messages (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL, -- Sender's user ID
          group_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          
          -- E2EE Fields for Pattern 1 (per-message key, client-specific portion)
          ciphertext BLOB NOT NULL,                 -- Encrypted message content (output of secretbox)
          msg_nonce BLOB NOT NULL,                  -- Nonce for secretbox(ciphertext)
          sender_ephemeral_public_key BLOB NOT NULL,-- Sender's ephemeral public key used to box the sym_key
          sym_key_encryption_nonce BLOB NOT NULL,   -- Nonce used to box the sym_key
          sealed_symmetric_key BLOB NOT NULL,       -- The symmetric message key, sealed for this device
          
          FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );
      `);

        await this.db.execAsync("DROP TABLE messages_old_v4;");
        await this.db.execAsync("COMMIT;");
        await this.db.execAsync(`PRAGMA user_version = 5`);
        currentDbVersion = 5;
        console.log("Successfully migrated to version 5.");
      } catch (e) {
        await this.db.execAsync("ROLLBACK;");
        console.error("Error migrating database to version 5:", e);
        throw e;
      }
    }

    if (currentDbVersion === 5) {
      console.log("Migrating to version 6 (Images support)...");
      await this.db.execAsync("BEGIN TRANSACTION;");
      try {
        await this.db.execAsync(`
          ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text';
        `);
        await this.db.execAsync("COMMIT;");
        await this.db.execAsync(`PRAGMA user_version = 6`);
        currentDbVersion = 6;
        console.log("Successfully migrated to version 6.");
      } catch (error) {
        await this.db.execAsync("ROLLBACK;");
        console.error("Error migrating database to version 6:", error);
      }
    }

    if (currentDbVersion === 6) {
      console.log("Migrating to version 7 (Group avatar blurhash)...");
      await this.db.execAsync("BEGIN TRANSACTION;");
      try {
        await this.db.execAsync(`
          ALTER TABLE groups ADD COLUMN blurhash TEXT;
        `);
        await this.db.execAsync("COMMIT;");
        await this.db.execAsync(`PRAGMA user_version = 7`);
        currentDbVersion = 7;
        console.log("Successfully migrated to version 7.");
      } catch (error) {
        await this.db.execAsync("ROLLBACK;");
        console.error("Error migrating database to version 7:", error);
      }
    }
    if (currentDbVersion === 7) {
      console.log("Migrating to version 8 (Group reads tracking)...");
      await this.db.execAsync("BEGIN TRANSACTION;");
      try {
        await this.db.execAsync(`
          CREATE TABLE group_reads (
            group_id TEXT NOT NULL,
            last_read_timestamp TEXT NOT NULL,
            PRIMARY KEY(group_id),
            FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
          );
        `);
        await this.db.execAsync("COMMIT;");
        await this.db.execAsync(`PRAGMA user_version = 8`);
        currentDbVersion = 8;
        console.log("Successfully migrated to version 8.");
      } catch (error) {
        await this.db.execAsync("ROLLBACK;");
        console.error("Error migrating database to version 8:", error);
        throw error;
      }
    }

    if (currentDbVersion === 8) {
      console.log("Migrating to version 9 (Group Message Timestamp Index)...");
      await this.db.execAsync("BEGIN TRANSACTION;");
      try {
        await this.db.execAsync(`
          CREATE INDEX idx_messages_group_id_timestamp ON messages(group_id, timestamp);
        `);
        await this.db.execAsync("COMMIT;");
        await this.db.execAsync(`PRAGMA user_version = 9`);
        currentDbVersion = 9;
        console.log("Successfully migrated to version 9.");
      } catch (error) {
        await this.db.execAsync("ROLLBACK;");
        console.error("Error migrating database to version 9:", error);
        throw error;
      }
    }

    if (currentDbVersion === 9) {
      console.log("Migrating to version 10 (Client ordering metadata)...");
      await this.db.execAsync("BEGIN TRANSACTION;");
      try {
        await this.db.execAsync(`
          ALTER TABLE messages ADD COLUMN client_seq INTEGER;
        `);
        await this.db.execAsync(`
          ALTER TABLE messages ADD COLUMN client_timestamp TEXT;
        `);
        await this.db.execAsync(`
          CREATE INDEX idx_messages_client_seq ON messages(client_seq);
        `);
        await this.db.execAsync("COMMIT;");
        await this.db.execAsync(`PRAGMA user_version = 10`);
        currentDbVersion = 10;
        console.log("Successfully migrated to version 10.");
      } catch (error) {
        await this.db.execAsync("ROLLBACK;");
        console.error("Error migrating database to version 10:", error);
        throw error;
      }
    }

    if (currentDbVersion === TARGET_DATABASE_VERSION) {
      console.log("Database is up to date.");
    } else if (currentDbVersion < TARGET_DATABASE_VERSION) {
      console.warn(
        `Database migration appears incomplete. Current version: ${currentDbVersion}, Target version: ${TARGET_DATABASE_VERSION}. Review migration logic.`
      );
    }
  }

  public async resetDatabase(): Promise<void> {
    console.warn("DEVELOPMENT MODE: Resetting database...");
    if (this.db) {
      try {
        await this.db.closeAsync();
        this.db = null;
      } catch (error) {
        console.error("Error closing database before reset:", error);
      }
    }

    await SQLite.deleteDatabaseAsync("store.db");
    console.log("database deleted");
  }

  private async getDb(): Promise<SQLite.SQLiteDatabase> {
    await this.initPromise;
    if (this.closed || !this.db) {
      throw new Error("Database not initialized or initialization failed.");
    }
    return this.db;
  }

  public isAvailable(): boolean {
    return !this.closed && this.db !== null;
  }

  /**
   * Executes a given operation within a database transaction, ensuring
   * that only one such operation runs at a time using a lock.
   */
  public async performSerialTransaction<T>(
    operation: (db: SQLite.SQLiteDatabase) => Promise<T>
  ): Promise<T> {
    const db = await this.getDb();

    let releaseLock = () => {};
    const currentLockExecution = this.transactionLock.then(async () => {
      await db.execAsync("BEGIN TRANSACTION;");
      try {
        const result = await operation(db);
        await db.execAsync("COMMIT;");
        return result;
      } catch (error) {
        console.error(
          "Error during serial transaction operation, attempting rollback:",
          error
        );
        try {
          await db.execAsync("ROLLBACK;");
        } catch (rollbackError) {
          console.error("Failed to rollback transaction:", rollbackError);
        }
        throw error;
      }
    });

    this.transactionLock = currentLockExecution
      .catch(() => {})
      .then(() => {
        releaseLock();
      });
    const lockReleasedPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      return await currentLockExecution;
    } finally {
    }
  }

  async saveMessages(
    messagesToSave: DbMessage[],
    clearFirst: boolean = false
  ): Promise<void> {
    return this.performSerialTransaction(async (db) => {
      if (clearFirst) {
        await db.runAsync("DELETE FROM messages;");
      }

      const userIDs = Array.from(
        new Set(messagesToSave.map((msg) => msg.sender_id))
      );
      const groupIDs = [...new Set(messagesToSave.map((msg) => msg.group_id))];

      const realGroups = await db.getAllAsync<{ id: string }>(
        `SELECT DISTINCT(id) FROM groups;`
      );
      const realGroupIDs = realGroups.map((group) => group.id);
      const diff_group_ids = groupIDs.filter(
        (id) => !realGroupIDs.includes(id)
      );

      for (const id of userIDs) {
        if (id) {
          await db.runAsync(
            `INSERT INTO users (id) VALUES (?)
             ON CONFLICT(id) DO NOTHING;`,
            [id]
          );
        }
      }
      for (const id of diff_group_ids) {
        await db.runAsync(
          `INSERT INTO groups (id) VALUES (?) ON CONFLICT(id) DO NOTHING;`,
          [id]
        );
      }
      for (const message of messagesToSave) {
        await db.runAsync(
          `INSERT OR REPLACE INTO messages (id, user_id, group_id, timestamp, client_seq, client_timestamp,
          ciphertext, message_type, msg_nonce, sender_ephemeral_public_key, sym_key_encryption_nonce, sealed_symmetric_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            message.id,
            message.sender_id,
            message.group_id,
            message.timestamp,
            message.client_seq ?? null,
            message.client_timestamp ?? null,
            message.ciphertext,
            message.message_type,
            message.msg_nonce,
            message.sender_ephemeral_public_key,
            message.sym_key_encryption_nonce,
            message.sealed_symmetric_key,
          ]
        );
      }
    });
  }

  async saveGroups(
    groupsToSave: Group[],
    clearFirstAndPrune: boolean = true
  ): Promise<void> {
    return this.performSerialTransaction(async (db) => {
      const incomingGroupIds = groupsToSave.map((group) => group.id);

      for (const group of groupsToSave) {
        await db.runAsync(
          `INSERT INTO groups (id, name, admin, group_users, created_at, updated_at, start_time, end_time, description, location, image_url, blurhash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, admin = excluded.admin, group_users = excluded.group_users,
             created_at = excluded.created_at, updated_at = excluded.updated_at,
             start_time = excluded.start_time, end_time = excluded.end_time,
             description = excluded.description, location = excluded.location, image_url = excluded.image_url,
             blurhash = excluded.blurhash
             ;
             
             `,
          [
            group.id,
            group.name,
            group.admin ? 1 : 0,
            JSON.stringify(group.group_users || []),
            group.created_at,
            group.updated_at,
            group.start_time,
            group.end_time,
            group.description ?? null,
            group.location ?? null,
            group.image_url ?? null,
            group.blurhash ?? null,
          ]
        );
      }

      if (clearFirstAndPrune) {
        if (incomingGroupIds.length > 0) {
          const placeholders = incomingGroupIds.map(() => "?").join(",");
          await db.runAsync(
            `DELETE FROM groups WHERE id NOT IN (${placeholders});`,
            incomingGroupIds
          );
        } else {
          await db.runAsync("DELETE FROM groups;");
        }
      }
    });
  }

  async saveUsers(usersToSave: User[]): Promise<void> {
    return this.performSerialTransaction(async (db) => {
      for (const user of usersToSave) {
        await db.runAsync(
          `INSERT OR REPLACE INTO users (id, username, email, created_at, updated_at, group_admin_map)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            user.id,
            user.username,
            user.email,
            user.created_at,
            user.updated_at,
            JSON.stringify(user.group_admin_map ?? {}),
          ]
        );
      }
    });
  }

  async clearMessages(): Promise<void> {
    const db = await this.getDb();
    await db.runAsync("DELETE FROM messages;");
  }
  async clearGroups(): Promise<void> {
    const db = await this.getDb();
    await db.runAsync("DELETE FROM groups;");
  }
  async clearUsers(): Promise<void> {
    const db = await this.getDb();
    await db.runAsync("DELETE FROM users;");
  }

  async loadMessages(): Promise<DbMessage[]> {
    const db = await this.getDb();
    const result = await db.getAllAsync<MessageRow>(`
      SELECT m.id as message_id, m.group_id,
            m.user_id, m.timestamp, m.client_seq, m.client_timestamp,
            m.ciphertext,
            m.message_type,
            m.msg_nonce,
            m.sender_ephemeral_public_key,
            m.sym_key_encryption_nonce,
            m.sealed_symmetric_key
      FROM messages AS m
    `);
    return (
      result?.map((row) => ({
        id: row.message_id,
        group_id: row.group_id,
        sender_id: row.user_id,
        timestamp: row.timestamp,
        client_seq: row.client_seq,
        client_timestamp: row.client_timestamp,
        ciphertext: row.ciphertext,
        message_type: row.message_type,
        msg_nonce: row.msg_nonce,
        sender_ephemeral_public_key: row.sender_ephemeral_public_key,
        sym_key_encryption_nonce: row.sym_key_encryption_nonce,
        sealed_symmetric_key: row.sealed_symmetric_key,
      })) ?? []
    );
  }
  async loadGroups(): Promise<Group[]> {
    const db = await this.getDb();
    const result = await db.getAllAsync<GroupRow>(
      `SELECT groups.*,
        group_reads.last_read_timestamp, 
        (SELECT MAX(messages.timestamp) FROM messages WHERE messages.group_id = groups.id) AS last_message_timestamp
        FROM groups 
        LEFT JOIN group_reads ON groups.id = group_reads.group_id
      `
    );
    return (
      result?.map((row) => {
        let parsedGroupUsers;
        try {
          parsedGroupUsers = JSON.parse(row.group_users);
        } catch (e) {
          parsedGroupUsers = [];
        }
        return {
          id: row.id,
          name: row.name,
          admin: !!row.admin,
          group_users: parsedGroupUsers,
          created_at: row.created_at,
          updated_at: row.updated_at,
          start_time: row.start_time,
          end_time: row.end_time,
          description: row.description,
          location: row.location,
          image_url: row.image_url,
          blurhash: row.blurhash,
          last_read_timestamp: row.last_read_timestamp,
          last_message_timestamp: row.last_message_timestamp,
        };
      }) ?? []
    );
  }
  async loadUsers(): Promise<User[]> {
    const db = await this.getDb();
    const result = await db.getAllAsync<UserRow>(`SELECT * FROM users;`);
    return (
      result?.map((row) => {
        let group_admin_map;
        try {
          group_admin_map = JSON.parse(row.group_admin_map ?? "{}");
        } catch (error) {
          group_admin_map = {};
        }
        return {
          id: row.id,
          username: row.username,
          email: row.email,
          created_at: row.created_at,
          updated_at: row.updated_at,
          group_admin_map: group_admin_map,
        };
      }) ?? []
    );
  }

  async markGroupRead(groupId: string) {
    if (!this.isAvailable()) {
      return;
    }
    const timestamp = new Date().toISOString();
    await this.performSerialTransaction((db) =>
      db.runAsync(
        `INSERT INTO group_reads(group_id, last_read_timestamp)
         VALUES (?, ?)
       ON CONFLICT(group_id) DO UPDATE 
         SET last_read_timestamp = excluded.last_read_timestamp;`,
        [groupId, timestamp]
      )
    );
  }

  async deleteGroup(groupId: string): Promise<void> {
    return this.performSerialTransaction(async (txDb) => {
      await txDb.runAsync(`DELETE FROM group_reads WHERE group_id = ?`, [groupId]);
      await txDb.runAsync(`DELETE FROM groups WHERE id = ?`, [groupId]);
      // messages cleaned up via ON DELETE CASCADE
    });
  }

  async deleteExpiredGroups(): Promise<string[]> {
    const db = await this.getDb();
    const expired = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM groups WHERE end_time IS NOT NULL AND end_time < datetime('now')`
    );
    if (expired.length === 0) return [];
    const expiredIds = expired.map((g) => g.id);
    return this.performSerialTransaction(async (txDb) => {
      const placeholders = expiredIds.map(() => "?").join(",");
      // Messages are cleaned up via ON DELETE CASCADE
      await txDb.runAsync(
        `DELETE FROM group_reads WHERE group_id IN (${placeholders})`,
        expiredIds
      );
      await txDb.runAsync(
        `DELETE FROM groups WHERE id IN (${placeholders})`,
        expiredIds
      );
      return expiredIds;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.initPromise;
      await this.transactionLock;
    } catch (error) {
      console.warn(
        "Error during pre-close waits (init or transaction lock):",
        error
      );
    }

    if (this.db) {
      try {
        await this.db.closeAsync();
        console.log("Database closed successfully.");
      } catch (closeError) {
        console.error("Error closing database:", closeError);
      } finally {
        this.db = null;
      }
    }
  }
}
