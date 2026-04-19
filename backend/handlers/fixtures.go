package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/andrewharris/lms/middleware"
)

const footballAPIBase = "https://api.football-data.org/v4"

func footballAPIKey() string {
	return os.Getenv("FOOTBALL_API_KEY")
}

func proxyFootball(path string) ([]byte, error) {
	req, err := http.NewRequest("GET", footballAPIBase+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Auth-Token", footballAPIKey())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("football API returned %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func HandleListCompetitions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if footballAPIKey() == "" {
			http.Error(w, "FOOTBALL_API_KEY not configured", http.StatusServiceUnavailable)
			return
		}
		data, err := proxyFootball("/competitions?plan=TIER_ONE")
		if err != nil {
			http.Error(w, "failed to fetch competitions", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	}
}

func HandleGetCompetitionTeams() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if footballAPIKey() == "" {
			http.Error(w, "FOOTBALL_API_KEY not configured", http.StatusServiceUnavailable)
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "code query param required", http.StatusBadRequest)
			return
		}
		data, err := proxyFootball("/competitions/" + code + "/teams")
		if err != nil {
			http.Error(w, "failed to fetch teams", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	}
}

type importFixtureRequest struct {
	GroupName string   `json:"groupName"`
	TeamNames []string `json:"teamNames"`
}

func HandleImportFixture(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())

		var req importFixtureRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if req.GroupName == "" || len(req.TeamNames) == 0 {
			http.Error(w, "groupName and teamNames required", http.StatusBadRequest)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		var groupID int
		err = tx.QueryRow(`INSERT INTO managed_groups (manager_id, name) VALUES ($1,$2) RETURNING id`,
			claims.UserID, req.GroupName).Scan(&groupID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		for _, name := range req.TeamNames {
			if _, err := tx.Exec(`INSERT INTO managed_teams (group_id, name) VALUES ($1,$2)`, groupID, name); err != nil {
				http.Error(w, "server error", http.StatusInternalServerError)
				return
			}
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"groupId": groupID, "teamCount": len(req.TeamNames)})
	}
}
