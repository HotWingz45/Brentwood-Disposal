-- Brentwood Disposal — Dispatcher Backend Schema
-- Run in Supabase SQL editor to create all tables.
-- RLS is intentionally disabled for Stage M (no auth yet).

-- ── Drivers ───────────────────────────────────────────────────────
create table if not exists drivers (
  id          text        primary key,
  device_info text        not null default '',
  created_at  timestamptz not null,
  last_seen   timestamptz not null
);

-- ── Routes ────────────────────────────────────────────────────────
create table if not exists routes (
  session_id  text        primary key,
  driver_id   text        not null references drivers(id),
  total_count integer     not null,
  created_at  timestamptz not null
);

-- ── Stops ─────────────────────────────────────────────────────────
create table if not exists stops (
  id              text    primary key,
  session_id      text    not null references routes(session_id),
  address         text    not null,
  latitude        double precision not null,
  longitude       double precision not null,
  sequence_number integer not null,
  status          text    not null
);

-- ── Active sessions ───────────────────────────────────────────────
create table if not exists active_sessions (
  session_id         text        primary key references routes(session_id),
  driver_id          text        not null references drivers(id),
  current_stop_index integer     not null,
  completed_count    integer     not null,
  skipped_count      integer     not null,
  session_status     text        not null,
  updated_at         timestamptz not null
);

-- ── Route events ──────────────────────────────────────────────────
create table if not exists route_events (
  id         uuid        primary key default gen_random_uuid(),
  session_id text        not null references routes(session_id),
  driver_id  text        not null references drivers(id),
  event_type text        not null,
  payload    jsonb       not null default '{}',
  created_at timestamptz not null default now()
);

-- ── Telemetry logs ────────────────────────────────────────────────
create table if not exists telemetry_logs (
  id         text        primary key,
  type       text        not null,
  driver_id  text        not null references drivers(id),
  session_id text        not null,
  payload    jsonb       not null default '{}',
  created_at timestamptz not null
);

-- Indexes for common dispatcher queries
create index if not exists idx_stops_session        on stops(session_id);
create index if not exists idx_telemetry_driver     on telemetry_logs(driver_id);
create index if not exists idx_telemetry_session    on telemetry_logs(session_id);
create index if not exists idx_telemetry_type       on telemetry_logs(type);
create index if not exists idx_active_sessions_driver on active_sessions(driver_id);
