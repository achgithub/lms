package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/andrewharris/lms/middleware"
	"github.com/andrewharris/lms/models"
	"github.com/gorilla/mux"
)

func HandleListGames(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())

		rows, err := db.Query(`
			SELECT g.id, g.manager_id, g.name, g.group_id, g.status, g.winner_name,
				g.postpone_as_win, g.winner_mode, g.rollover_mode, g.max_winners, g.pick_mode, g.created_at,
				COALESCE(gr.name,'') as group_name,
				COALESCE(COUNT(DISTINCT p.id),0) as participant_count,
				COALESCE(MAX(r.round_number),0) as current_round
			FROM managed_games g
			LEFT JOIN managed_groups gr ON gr.id = g.group_id
			LEFT JOIN managed_participants p ON p.game_id = g.id
			LEFT JOIN managed_rounds r ON r.game_id = g.id
			WHERE g.manager_id = $1
			GROUP BY g.id, gr.name
			ORDER BY g.created_at DESC
		`, claims.UserID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		games := []models.GameWithDetails{}
		for rows.Next() {
			var g models.GameWithDetails
			var winner sql.NullString
			if err := rows.Scan(&g.ID, &g.ManagerID, &g.Name, &g.GroupID, &g.Status, &winner,
				&g.PostponeAsWin, &g.WinnerMode, &g.RolloverMode, &g.MaxWinners, &g.PickMode, &g.CreatedAt,
				&g.GroupName, &g.ParticipantCount, &g.CurrentRound); err != nil {
				continue
			}
			if winner.Valid {
				g.WinnerName = &winner.String
			}
			games = append(games, g)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"games": games})
	}
}

func HandleCreateGame(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())

		var req models.CreateGameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if req.Name == "" || req.GroupID == 0 || len(req.PlayerNames) == 0 {
			http.Error(w, "name, groupId, and playerNames required", http.StatusBadRequest)
			return
		}
		if req.WinnerMode == "" {
			req.WinnerMode = "single"
		}
		if req.RolloverMode == "" {
			req.RolloverMode = "round"
		}
		if req.MaxWinners == 0 {
			req.MaxWinners = 1
		}
		if req.PickMode == "" {
			req.PickMode = "manager"
		}

		var count int
		db.QueryRow(`SELECT COUNT(*) FROM managed_groups WHERE id=$1 AND manager_id=$2`, req.GroupID, claims.UserID).Scan(&count)
		if count == 0 {
			http.Error(w, "group not found", http.StatusNotFound)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		var gameID int
		err = tx.QueryRow(`
			INSERT INTO managed_games
				(manager_id, name, group_id, status, postpone_as_win, winner_mode, rollover_mode, max_winners, pick_mode)
			VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8) RETURNING id
		`, claims.UserID, req.Name, req.GroupID, req.PostponeAsWin, req.WinnerMode,
			req.RolloverMode, req.MaxWinners, req.PickMode).Scan(&gameID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		for _, name := range req.PlayerNames {
			if _, err := tx.Exec(`
				INSERT INTO managed_participants (game_id, player_name, is_active) VALUES ($1,$2,true)
			`, gameID, name); err != nil {
				http.Error(w, "server error", http.StatusInternalServerError)
				return
			}
		}

		if _, err := tx.Exec(`INSERT INTO managed_rounds (game_id, round_number, status) VALUES ($1,1,'open')`, gameID); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"id": gameID})
	}
}

func HandleGetGame(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		gameID, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var game models.GameWithDetails
		var winner sql.NullString
		err = db.QueryRow(`
			SELECT g.id, g.manager_id, g.name, g.group_id, g.status, g.winner_name,
				g.postpone_as_win, g.winner_mode, g.rollover_mode, g.max_winners, g.pick_mode, g.created_at,
				COALESCE(gr.name,'') as group_name,
				COALESCE(COUNT(DISTINCT p.id),0) as participant_count,
				COALESCE(MAX(r.round_number),0) as current_round
			FROM managed_games g
			LEFT JOIN managed_groups gr ON gr.id = g.group_id
			LEFT JOIN managed_participants p ON p.game_id = g.id
			LEFT JOIN managed_rounds r ON r.game_id = g.id
			WHERE g.id=$1 AND g.manager_id=$2
			GROUP BY g.id, gr.name
		`, gameID, claims.UserID).Scan(&game.ID, &game.ManagerID, &game.Name, &game.GroupID, &game.Status, &winner,
			&game.PostponeAsWin, &game.WinnerMode, &game.RolloverMode, &game.MaxWinners, &game.PickMode, &game.CreatedAt,
			&game.GroupName, &game.ParticipantCount, &game.CurrentRound)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		if winner.Valid {
			game.WinnerName = &winner.String
		}

		participantRows, err := db.Query(`
			SELECT id, game_id, user_id, player_name, is_active, eliminated_in_round, created_at
			FROM managed_participants WHERE game_id=$1 ORDER BY player_name
		`, gameID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer participantRows.Close()

		participants := []models.Participant{}
		for participantRows.Next() {
			var p models.Participant
			var uid sql.NullInt64
			var elim sql.NullInt64
			if err := participantRows.Scan(&p.ID, &p.GameID, &uid, &p.PlayerName, &p.IsActive, &elim, &p.CreatedAt); err != nil {
				continue
			}
			if uid.Valid {
				v := int(uid.Int64)
				p.UserID = &v
			}
			if elim.Valid {
				v := int(elim.Int64)
				p.EliminatedInRound = &v
			}
			participants = append(participants, p)
		}

		roundRows, err := db.Query(`
			SELECT id, game_id, round_number, status, created_at
			FROM managed_rounds WHERE game_id=$1 ORDER BY round_number
		`, gameID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer roundRows.Close()

		rounds := []models.Round{}
		for roundRows.Next() {
			var rnd models.Round
			if err := roundRows.Scan(&rnd.ID, &rnd.GameID, &rnd.RoundNumber, &rnd.Status, &rnd.CreatedAt); err != nil {
				continue
			}
			rounds = append(rounds, rnd)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"game": game, "participants": participants, "rounds": rounds,
		})
	}
}

func HandleDeleteGame(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		gameID, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		result, err := db.Exec(`DELETE FROM managed_games WHERE id=$1 AND manager_id=$2`, gameID, claims.UserID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleGetUsedTeams(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		gameID, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var count int
		db.QueryRow(`SELECT COUNT(*) FROM managed_games WHERE id=$1 AND manager_id=$2`, gameID, claims.UserID).Scan(&count)
		if count == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		rows, err := db.Query(`
			SELECT p.player_name, p.team_id
			FROM managed_picks p
			JOIN managed_rounds r ON r.id = p.round_id
			WHERE p.game_id=$1 AND p.team_id IS NOT NULL AND r.status='closed'
		`, gameID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		usedTeams := make(map[string][]int)
		for rows.Next() {
			var name string
			var teamID int
			if err := rows.Scan(&name, &teamID); err != nil {
				continue
			}
			usedTeams[name] = append(usedTeams[name], teamID)
		}

		// Also collect used team names (from both regular picks via managed_teams and fixture picks)
		nameRows, err := db.Query(`
			SELECT p.player_name, t.name
			FROM managed_picks p
			JOIN managed_teams t ON t.id = p.team_id
			JOIN managed_rounds r ON r.id = p.round_id
			WHERE p.game_id=$1 AND p.team_id IS NOT NULL AND r.status='closed'
			UNION ALL
			SELECT p.player_name,
			       CASE p.picked_side WHEN 'home' THEN f.home_team_name ELSE f.away_team_name END
			FROM managed_picks p
			JOIN fixtures f ON f.id = p.fixture_id
			JOIN managed_rounds r ON r.id = p.round_id
			WHERE p.game_id=$1 AND p.fixture_id IS NOT NULL AND r.status='closed'
		`, gameID, gameID)
		if err == nil {
			defer nameRows.Close()
			usedTeamNames := make(map[string][]string)
			for nameRows.Next() {
				var player, teamName string
				if nameRows.Scan(&player, &teamName) == nil {
					usedTeamNames[player] = append(usedTeamNames[player], teamName)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"usedTeams":     usedTeams,
				"usedTeamNames": usedTeamNames,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"usedTeams": usedTeams})
	}
}

func HandleAddParticipants(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		gameID, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var status string
		err = db.QueryRow(`SELECT status FROM managed_games WHERE id=$1 AND manager_id=$2`, gameID, claims.UserID).Scan(&status)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if status != "active" {
			http.Error(w, "game is not active", http.StatusBadRequest)
			return
		}

		var req struct {
			PlayerNames []string `json:"playerNames"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.PlayerNames) == 0 {
			http.Error(w, "playerNames required", http.StatusBadRequest)
			return
		}

		tx, _ := db.Begin()
		defer tx.Rollback()
		for _, name := range req.PlayerNames {
			tx.Exec(`INSERT INTO managed_participants (game_id,player_name,is_active) VALUES ($1,$2,true) ON CONFLICT DO NOTHING`,
				gameID, name)
		}
		tx.Commit()
		w.WriteHeader(http.StatusNoContent)
	}
}

// HandleAdvanceRound — ported directly from reference, adapted to manager_id
func HandleAdvanceRound(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		gameID, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var winnerMode, rolloverMode string
		var maxWinners int
		err = db.QueryRow(`SELECT winner_mode, rollover_mode, max_winners FROM managed_games WHERE id=$1 AND manager_id=$2`,
			gameID, claims.UserID).Scan(&winnerMode, &rolloverMode, &maxWinners)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		var currentRound int
		db.QueryRow(`SELECT COALESCE(MAX(round_number),0) FROM managed_rounds WHERE game_id=$1`, gameID).Scan(&currentRound)

		var activeCount int
		db.QueryRow(`SELECT COUNT(*) FROM managed_participants WHERE game_id=$1 AND is_active=true`, gameID).Scan(&activeCount)

		jsonOK := func(data map[string]interface{}) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(data)
		}

		completeGame := func(winners []string) {
			name := joinNames(winners)
			db.Exec(`UPDATE managed_games SET status='completed', winner_name=$1 WHERE id=$2`, name, gameID)
			jsonOK(map[string]interface{}{"status": "completed", "winnerName": name, "multipleWinners": len(winners) > 1})
		}

		rolloverGame := func() {
			tx, _ := db.Begin()
			tx.Exec(`UPDATE managed_participants SET is_active=true, eliminated_in_round=NULL WHERE game_id=$1`, gameID)
			tx.Exec(`DELETE FROM managed_picks WHERE game_id=$1`, gameID)
			tx.Exec(`DELETE FROM managed_rounds WHERE game_id=$1`, gameID)
			tx.Exec(`INSERT INTO managed_rounds (game_id, round_number, status) VALUES ($1,1,'open')`, gameID)
			tx.Commit()
			jsonOK(map[string]interface{}{"roundNumber": 1, "rollover": "game"})
		}

		rolloverRound := func() {
			db.Exec(`UPDATE managed_participants SET is_active=true, eliminated_in_round=NULL WHERE game_id=$1 AND eliminated_in_round=$2`,
				gameID, currentRound)
		}

		if winnerMode == "single" {
			if activeCount == 1 {
				var name string
				db.QueryRow(`SELECT player_name FROM managed_participants WHERE game_id=$1 AND is_active=true`, gameID).Scan(&name)
				completeGame([]string{name})
				return
			}
			if activeCount == 0 {
				if rolloverMode == "game" {
					rolloverGame()
					return
				}
				rolloverRound()
			}
		} else {
			if activeCount > 0 && activeCount <= maxWinners {
				rows, _ := db.Query(`SELECT player_name FROM managed_participants WHERE game_id=$1 AND is_active=true ORDER BY player_name`, gameID)
				winners := scanNames(rows)
				completeGame(winners)
				return
			}
			if activeCount == 0 {
				var eliminatedCount int
				db.QueryRow(`SELECT COUNT(*) FROM managed_participants WHERE game_id=$1 AND eliminated_in_round=$2`,
					gameID, currentRound).Scan(&eliminatedCount)
				if eliminatedCount <= maxWinners {
					rows, _ := db.Query(`SELECT player_name FROM managed_participants WHERE game_id=$1 AND eliminated_in_round=$2 ORDER BY player_name`,
						gameID, currentRound)
					winners := scanNames(rows)
					completeGame(winners)
					return
				}
				if rolloverMode == "game" {
					rolloverGame()
					return
				}
				rolloverRound()
			}
		}

		next := currentRound + 1
		if _, err := db.Exec(`INSERT INTO managed_rounds (game_id, round_number, status) VALUES ($1,$2,'open')`, gameID, next); err != nil {
			log.Printf("advance round: %v", err)
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		jsonOK(map[string]interface{}{"roundNumber": next})
	}
}

func joinNames(names []string) string {
	result := ""
	for i, n := range names {
		if i > 0 {
			result += ", "
		}
		result += n
	}
	return result
}

func scanNames(rows *sql.Rows) []string {
	defer rows.Close()
	var names []string
	for rows.Next() {
		var n string
		rows.Scan(&n)
		names = append(names, n)
	}
	return names
}
