package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/andrewharris/lms/middleware"
	"github.com/gorilla/mux"
)

// --- football-data.org response shapes ---

type apiMatchScore struct {
	FullTime struct {
		Home *int `json:"home"`
		Away *int `json:"away"`
	} `json:"fullTime"`
}

type apiTeam struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type apiMatch struct {
	ID          int           `json:"id"`
	UTCDate     string        `json:"utcDate"`
	Status      string        `json:"status"`
	HomeTeam    apiTeam       `json:"homeTeam"`
	AwayTeam    apiTeam       `json:"awayTeam"`
	Score       apiMatchScore `json:"score"`
	Competition struct {
		Name string `json:"name"`
		Code string `json:"code"`
	} `json:"competition"`
}

type apiMatchesResponse struct {
	Matches []apiMatch `json:"matches"`
}

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

// HandleImportMatches fetches the next 28 days of fixtures from the football API and upserts into DB.
func HandleImportMatches(db *sql.DB) http.HandlerFunc {
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
		now := time.Now()
		dateFrom := now.Format("2006-01-02")
		dateTo := now.AddDate(0, 0, 28).Format("2006-01-02")

		data, err := proxyFootball(fmt.Sprintf("/competitions/%s/matches?dateFrom=%s&dateTo=%s", code, dateFrom, dateTo))
		if err != nil {
			http.Error(w, "failed to fetch fixtures: "+err.Error(), http.StatusBadGateway)
			return
		}

		var resp apiMatchesResponse
		if err := json.Unmarshal(data, &resp); err != nil {
			http.Error(w, "failed to parse fixtures", http.StatusInternalServerError)
			return
		}

		count, err := upsertMatches(db, resp.Matches)
		if err != nil {
			http.Error(w, "failed to save fixtures", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"imported": count})
	}
}

// HandleUpdateResults fetches the past 7 days and updates results for finished matches.
func HandleUpdateResults(db *sql.DB) http.HandlerFunc {
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
		now := time.Now()
		dateFrom := now.AddDate(0, 0, -7).Format("2006-01-02")
		dateTo := now.Format("2006-01-02")

		data, err := proxyFootball(fmt.Sprintf("/competitions/%s/matches?dateFrom=%s&dateTo=%s", code, dateFrom, dateTo))
		if err != nil {
			http.Error(w, "failed to fetch results: "+err.Error(), http.StatusBadGateway)
			return
		}

		var resp apiMatchesResponse
		if err := json.Unmarshal(data, &resp); err != nil {
			http.Error(w, "failed to parse results", http.StatusInternalServerError)
			return
		}

		count, err := upsertMatches(db, resp.Matches)
		if err != nil {
			http.Error(w, "failed to update results", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"updated": count})
	}
}

// HandleListFixtures returns stored fixtures from DB for a given competition, ordered by date.
func HandleListFixtures(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "code query param required", http.StatusBadRequest)
			return
		}

		rows, err := db.Query(`
			SELECT id, api_match_id, competition_code, competition_name,
			       match_date, home_team_name, away_team_name, status, home_score, away_score
			FROM fixtures
			WHERE competition_code = $1
			ORDER BY match_date ASC
		`, code)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type FixtureRow struct {
			ID              int      `json:"id"`
			APIMatchID      int      `json:"apiMatchId"`
			CompetitionCode string   `json:"competitionCode"`
			CompetitionName string   `json:"competitionName"`
			MatchDate       string   `json:"matchDate"`
			HomeTeam        string   `json:"homeTeam"`
			AwayTeam        string   `json:"awayTeam"`
			Status          string   `json:"status"`
			HomeScore       *int     `json:"homeScore"`
			AwayScore       *int     `json:"awayScore"`
		}

		fixtures := []FixtureRow{}
		for rows.Next() {
			var f FixtureRow
			var matchDate time.Time
			if err := rows.Scan(&f.ID, &f.APIMatchID, &f.CompetitionCode, &f.CompetitionName,
				&matchDate, &f.HomeTeam, &f.AwayTeam, &f.Status, &f.HomeScore, &f.AwayScore); err != nil {
				continue
			}
			f.MatchDate = matchDate.UTC().Format(time.RFC3339)
			fixtures = append(fixtures, f)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"fixtures": fixtures})
	}
}

// HandleListFixturesByDate returns fixtures from DB within a date range.
func HandleListFixturesByDate(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dateFrom := r.URL.Query().Get("dateFrom")
		dateTo := r.URL.Query().Get("dateTo")
		if dateFrom == "" || dateTo == "" {
			http.Error(w, "dateFrom and dateTo required", http.StatusBadRequest)
			return
		}

		rows, err := db.Query(`
			SELECT id, api_match_id, competition_code, competition_name,
			       match_date, home_team_name, away_team_name, status, home_score, away_score
			FROM fixtures
			WHERE match_date::date >= $1::date AND match_date::date <= $2::date
			ORDER BY match_date ASC
		`, dateFrom, dateTo)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type FixtureRow struct {
			ID              int    `json:"id"`
			APIMatchID      int    `json:"apiMatchId"`
			CompetitionCode string `json:"competitionCode"`
			CompetitionName string `json:"competitionName"`
			MatchDate       string `json:"matchDate"`
			HomeTeam        string `json:"homeTeam"`
			AwayTeam        string `json:"awayTeam"`
			Status          string `json:"status"`
			HomeScore       *int   `json:"homeScore"`
			AwayScore       *int   `json:"awayScore"`
		}

		fixtures := []FixtureRow{}
		for rows.Next() {
			var f FixtureRow
			var matchDate time.Time
			if err := rows.Scan(&f.ID, &f.APIMatchID, &f.CompetitionCode, &f.CompetitionName,
				&matchDate, &f.HomeTeam, &f.AwayTeam, &f.Status, &f.HomeScore, &f.AwayScore); err != nil {
				continue
			}
			f.MatchDate = matchDate.UTC().Format(time.RFC3339)
			fixtures = append(fixtures, f)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"fixtures": fixtures})
	}
}

// HandleManualFixtureResult lets a manager manually set a fixture score (for testing).
// A real "Check for Results" call will overwrite this with live data.
func HandleManualFixtureResult(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fixtureID, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}
		var body struct {
			HomeScore *int   `json:"homeScore"`
			AwayScore *int   `json:"awayScore"`
			Status    string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if body.Status == "" {
			body.Status = "FINISHED"
		}
		_, err = db.Exec(`UPDATE fixtures SET home_score=$1, away_score=$2, status=$3, updated_at=NOW() WHERE id=$4`,
			body.HomeScore, body.AwayScore, body.Status, fixtureID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func upsertMatches(db *sql.DB, matches []apiMatch) (int, error) {
	count := 0
	for _, m := range matches {
		matchDate, err := time.Parse(time.RFC3339, m.UTCDate)
		if err != nil {
			continue
		}
		_, err = db.Exec(`
			INSERT INTO fixtures
				(api_match_id, competition_code, competition_name, match_date,
				 home_team_api_id, home_team_name, away_team_api_id, away_team_name,
				 status, home_score, away_score, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
			ON CONFLICT (api_match_id) DO UPDATE SET
				status      = EXCLUDED.status,
				home_score  = EXCLUDED.home_score,
				away_score  = EXCLUDED.away_score,
				updated_at  = NOW()
		`, m.ID, m.Competition.Code, m.Competition.Name, matchDate,
			m.HomeTeam.ID, m.HomeTeam.Name, m.AwayTeam.ID, m.AwayTeam.Name,
			m.Status, m.Score.FullTime.Home, m.Score.FullTime.Away)
		if err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}
