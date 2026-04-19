CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','manager','games','reports','player')),
  must_change_pw BOOLEAN NOT NULL DEFAULT true,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by     INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS managed_groups (
  id         SERIAL PRIMARY KEY,
  manager_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS managed_teams (
  id         SERIAL PRIMARY KEY,
  group_id   INT NOT NULL REFERENCES managed_groups(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS managed_players (
  id         SERIAL PRIMARY KEY,
  manager_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id),
  name       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (manager_id, name)
);

CREATE TABLE IF NOT EXISTS managed_games (
  id              SERIAL PRIMARY KEY,
  manager_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  group_id        INT NOT NULL REFERENCES managed_groups(id),
  status          TEXT NOT NULL DEFAULT 'active',
  winner_name     TEXT,
  postpone_as_win BOOLEAN NOT NULL DEFAULT false,
  winner_mode     TEXT NOT NULL DEFAULT 'single',
  rollover_mode   TEXT NOT NULL DEFAULT 'round',
  max_winners     INT NOT NULL DEFAULT 1,
  pick_mode       TEXT NOT NULL DEFAULT 'manager',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS managed_participants (
  id                  SERIAL PRIMARY KEY,
  game_id             INT NOT NULL REFERENCES managed_games(id) ON DELETE CASCADE,
  user_id             INT REFERENCES users(id),
  player_name         TEXT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  eliminated_in_round INT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, player_name)
);

CREATE TABLE IF NOT EXISTS managed_rounds (
  id           SERIAL PRIMARY KEY,
  game_id      INT NOT NULL REFERENCES managed_games(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS managed_picks (
  id            SERIAL PRIMARY KEY,
  game_id       INT NOT NULL REFERENCES managed_games(id) ON DELETE CASCADE,
  round_id      INT NOT NULL REFERENCES managed_rounds(id) ON DELETE CASCADE,
  player_name   TEXT NOT NULL,
  team_id       INT REFERENCES managed_teams(id),
  result        TEXT,
  auto_assigned BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, round_id, player_name)
);

-- Admin user is seeded by the Go backend on first startup (see main.go seedAdmin)
