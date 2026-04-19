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
// Safe to call on every startup (uses IF NOT EXISTS).
func AutoMigrate(database *sql.DB) error {
	_, err := database.Exec(`
		CREATE TABLE IF NOT EXISTS fixtures (
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
		)
	`)
	return err
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
