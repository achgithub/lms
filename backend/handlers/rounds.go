package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/andrewharris/lms/middleware"
	"github.com/andrewharris/lms/models"
	"github.com/gorilla/mux"
)

func HandleGetRoundPicks(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		roundID, err := strconv.Atoi(mux.Vars(r)["roundId"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var count int
		db.QueryRow(`
			SELECT COUNT(*) FROM managed_rounds r
			JOIN managed_games g ON g.id=r.game_id
			WHERE r.id=$1 AND g.manager_id=$2
		`, roundID, claims.UserID).Scan(&count)
		if count == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		rows, err := db.Query(`
			SELECT p.id, p.game_id, p.round_id, p.player_name, p.team_id, p.result, p.auto_assigned, p.created_at,
				COALESCE(t.name,'') as team_name
			FROM managed_picks p
			LEFT JOIN managed_teams t ON t.id=p.team_id
			WHERE p.round_id=$1 ORDER BY p.player_name
		`, roundID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		picks := []models.PickWithTeamName{}
		for rows.Next() {
			var p models.PickWithTeamName
			var teamID sql.NullInt64
			var result sql.NullString
			if err := rows.Scan(&p.ID, &p.GameID, &p.RoundID, &p.PlayerName, &teamID, &result, &p.AutoAssigned, &p.CreatedAt, &p.TeamName); err != nil {
				continue
			}
			if teamID.Valid {
				v := int(teamID.Int64)
				p.TeamID = &v
			}
			if result.Valid {
				p.Result = &result.String
			}
			picks = append(picks, p)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"picks": picks})
	}
}

func HandleSavePicks(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		roundID, err := strconv.Atoi(mux.Vars(r)["roundId"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var gameID int
		err = db.QueryRow(`
			SELECT r.game_id FROM managed_rounds r
			JOIN managed_games g ON g.id=r.game_id
			WHERE r.id=$1 AND g.manager_id=$2
		`, roundID, claims.UserID).Scan(&gameID)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		var req models.SavePicksRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		tx, _ := db.Begin()
		defer tx.Rollback()
		for _, pick := range req.Picks {
			tx.Exec(`
				INSERT INTO managed_picks (game_id, round_id, player_name, team_id, auto_assigned)
				VALUES ($1,$2,$3,$4,false)
				ON CONFLICT (game_id,round_id,player_name)
				DO UPDATE SET team_id=EXCLUDED.team_id, auto_assigned=false
			`, gameID, roundID, pick.PlayerName, pick.TeamID)
		}
		tx.Commit()
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleFinalizePicks(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		roundID, err := strconv.Atoi(mux.Vars(r)["roundId"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var gameID, groupID int
		err = db.QueryRow(`
			SELECT r.game_id, g.group_id FROM managed_rounds r
			JOIN managed_games g ON g.id=r.game_id
			WHERE r.id=$1 AND g.manager_id=$2 AND r.status='open'
		`, roundID, claims.UserID).Scan(&gameID, &groupID)
		if err == sql.ErrNoRows {
			http.Error(w, "round not found or already closed", http.StatusNotFound)
			return
		}

		// Active participants
		pRows, _ := db.Query(`SELECT player_name FROM managed_participants WHERE game_id=$1 AND is_active=true ORDER BY player_name`, gameID)
		participants := scanNames(pRows)

		// Existing picks
		pickRows, _ := db.Query(`SELECT player_name, team_id FROM managed_picks WHERE round_id=$1 AND team_id IS NOT NULL`, roundID)
		defer pickRows.Close()
		picksMap := make(map[string]int)
		for pickRows.Next() {
			var name string
			var tid int
			pickRows.Scan(&name, &tid)
			picksMap[name] = tid
		}

		var missing []string
		for _, p := range participants {
			if _, ok := picksMap[p]; !ok {
				missing = append(missing, p)
			}
		}

		if len(missing) > 0 {
			// All teams in group sorted alphabetically
			tRows, _ := db.Query(`SELECT id FROM managed_teams WHERE group_id=$1 ORDER BY name`, groupID)
			defer tRows.Close()
			var allTeams []int
			for tRows.Next() {
				var tid int
				tRows.Scan(&tid)
				allTeams = append(allTeams, tid)
			}

			// Used teams per player from closed rounds
			utRows, _ := db.Query(`
				SELECT p.player_name, p.team_id FROM managed_picks p
				JOIN managed_rounds r ON r.id=p.round_id
				WHERE p.game_id=$1 AND p.team_id IS NOT NULL AND r.status='closed'
			`, gameID)
			defer utRows.Close()
			usedMap := make(map[string]map[int]bool)
			for utRows.Next() {
				var name string
				var tid int
				utRows.Scan(&name, &tid)
				if usedMap[name] == nil {
					usedMap[name] = make(map[int]bool)
				}
				usedMap[name][tid] = true
			}

			tx, _ := db.Begin()
			defer tx.Rollback()
			for _, player := range missing {
				var assigned int
				for _, tid := range allTeams {
					if usedMap[player] == nil || !usedMap[player][tid] {
						assigned = tid
						break
					}
				}
				if assigned == 0 {
					http.Error(w, "no available teams for auto-assignment", http.StatusBadRequest)
					return
				}
				tx.Exec(`
					INSERT INTO managed_picks (game_id,round_id,player_name,team_id,auto_assigned)
					VALUES ($1,$2,$3,$4,true)
					ON CONFLICT (game_id,round_id,player_name)
					DO UPDATE SET team_id=EXCLUDED.team_id, auto_assigned=true
				`, gameID, roundID, player, assigned)
				if usedMap[player] == nil {
					usedMap[player] = make(map[int]bool)
				}
				usedMap[player][assigned] = true
			}
			tx.Commit()
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"missingCount": len(missing), "autoAssigned": missing})
	}
}

func HandleSaveResults(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		roundID, err := strconv.Atoi(mux.Vars(r)["roundId"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var gameID, roundNumber int
		var postponeAsWin bool
		err = db.QueryRow(`
			SELECT r.game_id, r.round_number, g.postpone_as_win FROM managed_rounds r
			JOIN managed_games g ON g.id=r.game_id
			WHERE r.id=$1 AND g.manager_id=$2
		`, roundID, claims.UserID).Scan(&gameID, &roundNumber, &postponeAsWin)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		var req models.SaveResultsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		tx, _ := db.Begin()
		defer tx.Rollback()

		for _, res := range req.Results {
			tx.Exec(`UPDATE managed_picks SET result=$1 WHERE id=$2`, res.Result, res.PickID)

			eliminate := res.Result == "loss" || res.Result == "draw" || (res.Result == "postponed" && !postponeAsWin)
			if eliminate {
				var playerName string
				db.QueryRow(`SELECT player_name FROM managed_picks WHERE id=$1`, res.PickID).Scan(&playerName)
				tx.Exec(`UPDATE managed_participants SET is_active=false, eliminated_in_round=$1 WHERE game_id=$2 AND player_name=$3`,
					roundNumber, gameID, playerName)
			}
		}
		tx.Commit()
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleCloseRound(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		roundID, err := strconv.Atoi(mux.Vars(r)["roundId"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var gameID int
		err = db.QueryRow(`
			SELECT r.game_id FROM managed_rounds r
			JOIN managed_games g ON g.id=r.game_id
			WHERE r.id=$1 AND g.manager_id=$2
		`, roundID, claims.UserID).Scan(&gameID)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		db.Exec(`UPDATE managed_rounds SET status='closed' WHERE id=$1`, roundID)
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleReopenRound(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		roundID, err := strconv.Atoi(mux.Vars(r)["roundId"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var gameID, roundNumber int
		err = db.QueryRow(`
			SELECT r.game_id, r.round_number FROM managed_rounds r
			JOIN managed_games g ON g.id=r.game_id
			WHERE r.id=$1 AND g.manager_id=$2
		`, roundID, claims.UserID).Scan(&gameID, &roundNumber)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		tx, _ := db.Begin()
		defer tx.Rollback()
		tx.Exec(`UPDATE managed_participants SET is_active=true, eliminated_in_round=NULL WHERE game_id=$1 AND eliminated_in_round=$2`, gameID, roundNumber)
		tx.Exec(`UPDATE managed_picks SET result=NULL WHERE round_id=$1`, roundID)
		tx.Exec(`UPDATE managed_rounds SET status='open' WHERE id=$1`, roundID)
		tx.Commit()
		w.WriteHeader(http.StatusNoContent)
	}
}
