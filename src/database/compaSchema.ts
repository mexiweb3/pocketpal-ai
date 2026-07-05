import {tableSchema} from '@nozbe/watermelondb';

const compaTable = (
  name: string,
  columns: Parameters<typeof tableSchema>[0]['columns'],
  sql: string,
) =>
  tableSchema({
    name,
    columns,
    unsafeSql: () => sql,
  });

export const COMPA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS compa_sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  turn_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES compa_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compa_messages_session
  ON compa_messages (session_id, turn_index, id);

CREATE TABLE IF NOT EXISTS compa_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact TEXT NOT NULL,
  category TEXT NOT NULL,
  salience INTEGER DEFAULT 3,
  confidence REAL DEFAULT 0.5,
  created_at INTEGER NOT NULL,
  last_referenced_at INTEGER,
  times_referenced INTEGER DEFAULT 0,
  superseded_by INTEGER REFERENCES compa_facts(id),
  source_session TEXT
);

CREATE INDEX IF NOT EXISTS idx_facts_active
  ON compa_facts (superseded_by, salience DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS compa_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  time_hhmm TEXT NOT NULL,
  days_mask INTEGER DEFAULT 127,
  enabled INTEGER DEFAULT 1,
  last_fired_at INTEGER
);

CREATE TABLE IF NOT EXISTS compa_weekly_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note TEXT NOT NULL,
  mood TEXT,
  created_at INTEGER NOT NULL,
  reported INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compa_safety_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_text TEXT NOT NULL,
  rule TEXT NOT NULL,
  notified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

export const compaTableSchemas = [
  compaTable(
    'compa_sessions',
    [
      {name: 'started_at', type: 'number'},
      {name: 'ended_at', type: 'number', isOptional: true},
      {name: 'turn_count', type: 'number', isOptional: true},
    ],
    `CREATE TABLE IF NOT EXISTS "compa_sessions" (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      turn_count INTEGER DEFAULT 0
    );`,
  ),
  compaTable(
    'compa_messages',
    [
      {name: 'session_id', type: 'string', isIndexed: true},
      {name: 'role', type: 'string'},
      {name: 'content', type: 'string'},
      {name: 'turn_index', type: 'number'},
      {name: 'created_at', type: 'number'},
    ],
    `CREATE TABLE IF NOT EXISTS "compa_messages" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES compa_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compa_messages_session
      ON compa_messages (session_id, turn_index, id);`,
  ),
  compaTable(
    'compa_facts',
    [
      {name: 'fact', type: 'string'},
      {name: 'category', type: 'string'},
      {name: 'salience', type: 'number', isOptional: true},
      {name: 'confidence', type: 'number', isOptional: true},
      {name: 'created_at', type: 'number'},
      {name: 'last_referenced_at', type: 'number', isOptional: true},
      {name: 'times_referenced', type: 'number', isOptional: true},
      {name: 'superseded_by', type: 'number', isOptional: true},
      {name: 'source_session', type: 'string', isOptional: true},
    ],
    `CREATE TABLE IF NOT EXISTS "compa_facts" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact TEXT NOT NULL,
      category TEXT NOT NULL,
      salience INTEGER DEFAULT 3,
      confidence REAL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      last_referenced_at INTEGER,
      times_referenced INTEGER DEFAULT 0,
      superseded_by INTEGER REFERENCES compa_facts(id),
      source_session TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_facts_active
      ON compa_facts (superseded_by, salience DESC, created_at DESC);`,
  ),
  compaTable(
    'compa_reminders',
    [
      {name: 'label', type: 'string'},
      {name: 'time_hhmm', type: 'string'},
      {name: 'days_mask', type: 'number', isOptional: true},
      {name: 'enabled', type: 'boolean', isOptional: true},
      {name: 'last_fired_at', type: 'number', isOptional: true},
    ],
    `CREATE TABLE IF NOT EXISTS "compa_reminders" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      time_hhmm TEXT NOT NULL,
      days_mask INTEGER DEFAULT 127,
      enabled INTEGER DEFAULT 1,
      last_fired_at INTEGER
    );`,
  ),
  compaTable(
    'compa_weekly_notes',
    [
      {name: 'note', type: 'string'},
      {name: 'mood', type: 'string', isOptional: true},
      {name: 'created_at', type: 'number'},
      {name: 'reported', type: 'boolean', isOptional: true},
    ],
    `CREATE TABLE IF NOT EXISTS "compa_weekly_notes" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note TEXT NOT NULL,
      mood TEXT,
      created_at INTEGER NOT NULL,
      reported INTEGER DEFAULT 0
    );`,
  ),
  compaTable(
    'compa_safety_events',
    [
      {name: 'trigger_text', type: 'string'},
      {name: 'rule', type: 'string'},
      {name: 'notified', type: 'boolean', isOptional: true},
      {name: 'created_at', type: 'number'},
    ],
    `CREATE TABLE IF NOT EXISTS "compa_safety_events" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_text TEXT NOT NULL,
      rule TEXT NOT NULL,
      notified INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );`,
  ),
];
