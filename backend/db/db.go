package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/lib/pq"
)

func Connect() (*sql.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		host := getEnv("DB_HOST", "localhost")
		port := getEnv("DB_PORT", "5432")
		user := getEnv("DB_USER", "lms")
		pass := getEnv("DB_PASS", "lms")
		name := getEnv("DB_NAME", "lms")
		dsn = fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
			host, port, user, pass, name)
	}

	database, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := database.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	log.Println("connected to postgres")
	return database, nil
}

// AutoMigrate creates any tables not handled by the SQL init scripts.
// Safe to call on every startup (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
func AutoMigrate(database *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS fixtures (
			id               SERIAL PRIMARY KEY,
			api_match_id     INT UNIQUE NOT NULL,
			competition_code TEXT NOT NULL,
			competition_name TEXT NOT NULL,
			match_date       TIMESTAMPTZ NOT NULL,
			home_team_api_id INT,
			home_team_name   TEXT NOT NULL,
			away_team_api_id INT,
			away_team_name   TEXT NOT NULL,
			status           TEXT NOT NULL DEFAULT 'SCHEDULED',
			home_score       INT,
			away_score       INT,
			updated_at       TIMESTAMPTZ DEFAULT NOW(),
			created_at       TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS round_fixtures (
			id         SERIAL PRIMARY KEY,
			round_id   INT REFERENCES managed_rounds(id) ON DELETE CASCADE,
			fixture_id INT REFERENCES fixtures(id) ON DELETE CASCADE,
			UNIQUE (round_id, fixture_id)
		)`,
		`ALTER TABLE managed_picks ADD COLUMN IF NOT EXISTS fixture_id INT REFERENCES fixtures(id)`,
		`ALTER TABLE managed_picks ADD COLUMN IF NOT EXISTS picked_side TEXT`,
		`ALTER TABLE managed_groups ADD COLUMN IF NOT EXISTS competition_code TEXT`,
	}
	for _, s := range stmts {
		if _, err := database.Exec(s); err != nil {
			return err
		}
	}
	return nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
