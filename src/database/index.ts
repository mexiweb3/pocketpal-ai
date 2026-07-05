import {Database} from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import type {Value} from '@nozbe/watermelondb/QueryDescription';
import type {SerializedQuery} from '@nozbe/watermelondb/Query';
import schema from './schema';
import migrations from './migrations';
import {memoryStore, type SqliteExecutor} from '../compa/memory/MemoryStore';
import {
  ChatSession,
  Message,
  CompletionSetting,
  GlobalSetting,
  CachedPal,
  UserLibrary,
  SyncStatus,
  LocalPal,
} from './models';

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  dbName: 'pocketpalai',
  jsi: true, // enable JSI for better performance if available
  onSetUpError: error => {
    console.error('Database setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [
    ChatSession,
    Message,
    CompletionSetting,
    GlobalSetting,
    CachedPal,
    UserLibrary,
    SyncStatus,
    LocalPal,
  ],
});

type SqlParam = string | number | boolean | null;

const COMPA_TABLES = [
  'compa_sessions',
  'compa_messages',
  'compa_facts',
  'compa_reminders',
  'compa_weekly_notes',
  'compa_safety_events',
] as const;

function inferCompaTable(sql: string): string {
  const normalized = sql.toLowerCase();
  return (
    COMPA_TABLES.find(table => normalized.includes(table)) ?? 'compa_facts'
  );
}

function rawQuery(
  sql: string,
  params: SqlParam[] = [],
): SerializedQuery {
  return {
    table: inferCompaTable(sql),
    description: {
      where: [],
      joinTables: [],
      nestedJoinTables: [],
      sortBy: [],
      sql: {
        type: 'sqlQuery',
        sql,
        values: params as Value[],
      },
    },
    associations: [],
  } as SerializedQuery;
}

export function createPocketPalSqliteExecutor(): SqliteExecutor {
  return {
    async executeAsync(sql, params = []) {
      const trimmed = sql.trim().toLowerCase();
      if (
        trimmed.startsWith('select') ||
        trimmed.startsWith('with') ||
        trimmed.startsWith('pragma') ||
        /\breturning\b/i.test(sql)
      ) {
        const rows = await database.adapter.unsafeQueryRaw(
          rawQuery(sql, params as SqlParam[]),
        );
        return {rows};
      }
      await database.adapter.unsafeExecute({
        sqls: [[sql, params as SqlParam[]]],
      });
      return {rows: []};
    },
  };
}

export function installCompaMemoryStoreExecutor(): void {
  memoryStore.setExecutor(createPocketPalSqliteExecutor());
}

installCompaMemoryStoreExecutor();

export {
  ChatSession,
  Message,
  CompletionSetting,
  GlobalSetting,
  CachedPal,
  UserLibrary,
  SyncStatus,
  LocalPal,
};
