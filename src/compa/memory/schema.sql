-- Compa: esquema de memoria de largo plazo
-- Se agrega como migración a src/database/migrations.ts de PocketPal

-- Sesiones completas: se guarda TODO el transcript localmente
CREATE TABLE IF NOT EXISTS compa_sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  turn_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES compa_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                -- system | user | assistant
  content TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compa_messages_session
  ON compa_messages (session_id, turn_index, id);

-- Hechos extraídos de las conversaciones (la memoria del Compa)
CREATE TABLE IF NOT EXISTS compa_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact TEXT NOT NULL,              -- "Le dolió la rodilla derecha al subir escaleras"
  category TEXT NOT NULL,          -- salud | familia | gustos | historia | estado_animo | otro
  salience INTEGER DEFAULT 3,      -- 1-5: qué tan importante (5 = salud/familia)
  confidence REAL DEFAULT 0.5,      -- 0-1: confianza del extractor
  created_at INTEGER NOT NULL,     -- epoch ms
  last_referenced_at INTEGER,      -- se actualiza cuando se inyecta y el tema reaparece
  times_referenced INTEGER DEFAULT 0,
  superseded_by INTEGER REFERENCES compa_facts(id),  -- hecho que lo reemplaza ("ya no le duele")
  source_session TEXT              -- id de sesión de origen, para auditar
);

CREATE INDEX IF NOT EXISTS idx_facts_active
  ON compa_facts (superseded_by, salience DESC, created_at DESC);

-- Recordatorios (medicinas, citas)
CREATE TABLE IF NOT EXISTS compa_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,             -- "Pastilla de la presión"
  time_hhmm TEXT NOT NULL,         -- "08:30"
  days_mask INTEGER DEFAULT 127,   -- bitmask Dom..Sab (127 = diario)
  enabled INTEGER DEFAULT 1,
  last_fired_at INTEGER
);

-- Notas para el resumen semanal a la familia
CREATE TABLE IF NOT EXISTS compa_weekly_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note TEXT NOT NULL,              -- "Lunes: de buen humor, platicó del Rayados-Tigres"
  mood TEXT,                       -- bien | regular | bajo
  created_at INTEGER NOT NULL,
  reported INTEGER DEFAULT 0       -- ya incluido en un resumen enviado
);

-- Eventos de seguridad (emergencias detectadas)
CREATE TABLE IF NOT EXISTS compa_safety_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_text TEXT NOT NULL,      -- lo que dijo
  rule TEXT NOT NULL,              -- regla que disparó
  notified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
