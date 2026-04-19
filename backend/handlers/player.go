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

func HandlePlayerListGames(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())

		rows, err := db.Query(`
			SELECT g.id, g.name, g.status, g.winner_name, g.pick_mode, g.created_at,
				COALESCE(gr.name,'') as group_name,
				COALESCE(MAX(rnd.round_number),0) as current_round,
				p.is_active, p.eliminated_in_round
			FROM managed_participants p
			JOIN managed_games g ON g.id=p.game_id
			LEFT JOIN managed_groups gr ON gr.id=g.group_id
			LEFT JOIN managed_rounds rnd ON rnd.game_id=g.id
			WHERE p.user_id=$1
			GROUP BY g.id, gr.name, p.is_active, p.eliminated_in_round
			ORDER BY g.created_at DESC
		`, claims.UserID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type playerGame struct {
			ID                int     `json:"id"`
			Name              string  `json:"name"`
			Status            string  `json:"status"`
			WinnerName        *string `json:"winnerName,omitempty"`
			PickMode          string  `json:"pickMode"`
			GroupName         string  `json:"groupName"`
			CurrentRound      int     `json:"currentRound"`
			IsActive          bool    `json:"isActive"`
			EliminatedInRound *int    `json:"eliminatedInRound,omitempty"`
		}

		games := []playerGame{}
		for rows.Next() {
			var g playerGame
			var winner sql.NullString
			var elim sql.NullInt64
			if err := rows.Scan(&g.ID, &g.Name, &g.Status, &winner, &g.PickMode, new(interface{}),
				&g.GroupName, &g.CurrentRound, &g.IsActive, &elim); err != nil {
				continue
			}
			if winner.Valid {
				g.WinnerName = &winner.String
			}
			if elim.Valid {
				v := int(elim.Int64)
				g.EliminatedInRound = &v
			}
			games = append(games, g)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"games": games})
	}
}

func HandlePlayerGetGame(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		gameID, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		// Verify player is a participant
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM managed_participants WHERE game_id=$1 AND user_id=$2`, gameID, claims.UserID).Scan(&count)
		if count == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		var game models.Game
		var winner sql.NullString
		err = db.QueryRow(`
			SELECT id, manager_id, name, group_id, status, winner_name,
				postpone_as_win, winner_mode, rollover_mode, max_winners, pick_mode, created_at
			FROM managed_games WHERE id=$1
		`, gameID).Scan(&game.ID, &game.ManagerID, &game.Name, &game.GroupID, &game.Status, &winner,
			&game.PostponeAsWin, &game.WinnerMode, &game.RolloverMode, &game.MaxWinners, &game.PickMode, &game.CreatedAt)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		if winner.Valid {
			game.WinnerName = &winner.String
		}

		// Standings
		pRows, _ := db.Query(`SELECT player_name, is_active, eliminated_in_round FROM managed_participants WHERE game_id=$1 ORDER BY player_name`, gameID)
		defer pRows.Close()
		type standing struct {
			PlayerName        string `json:"playerName"`
			IsActive          bool   `json:"isActive"`
			EliminatedInRound *int   `json:"eliminatedInRound,omitempty"`
		}
		standings := []standing{}
		for pRows.Next() {
			var s standing
			var elim sql.NullInt64
			pRows.Scan(&s.PlayerName, &s.IsActive, &elim)
			if elim.Valid {
				v := int(elim.Int64)
				s.EliminatedInRound = &v
			}
			standings = append(standings, s)
		}

		// Open round + player's pick
		var openRoundID, openRoundNumber int
		var openRoundStatus string
		db.QueryRow(`SELECT id, round_number, status FROM managed_rounds WHERE game_id=$1 AND status='open' LIMIT 1`,
			gameID).Scan(&openRoundID, &openRoundNumber, &openRoundStatus)

		var myPick *struct {
			TeamID   *int   `json:"teamId"`
			TeamName string `json:"teamName"`
		}
		if openRoundID > 0 {
			var teamID sql.NullInt64
			var teamName sql.NullString
			db.QueryRow(`
				SELECT p.team_id, COALESCE(t.name,'') FROM managed_picks p
				LEFT JOIN managed_teams t ON t.id=p.team_id
				WHERE p.round_id=$1 AND p.player_name=(
					SELECT player_name FROM managed_participants WHERE game_id=$2 AND user_id=$3 LIMIT 1
				)
			`, openRoundID, gameID, claims.UserID).Scan(&teamID, &teamName)
			myPick = &struct {
				TeamID   *int   `json:"teamId"`
				TeamName string `json:"teamName"`
			}{}
			if teamID.Valid {
				v := int(teamID.Int64)
				myPick.TeamID = &v
			}
			if teamName.Valid {
				myPick.TeamName = teamName.String
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"game":          game,
			"standings":     standings,
			"openRoundId":   openRoundID,
			"openRound":     openRoundNumber,
			"myPick":        myPick,
		})
	}
}

func HandlePlayerSavePick(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		roundID, err := strconv.Atoi(mux.Vars(r)["roundId"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		// Verify round is open, game is player-mode, player is active participant
		var gameID int
		var pickMode string
		var roundStatus string
		err = db.QueryRow(`
			SELECT r.game_id, g.pick_mode, r.status FROM managed_rounds r
			JOIN managed_games g ON g.id=r.game_id
			WHERE r.id=$1
		`, roundID).Scan(&gameID, &pickMode, &roundStatus)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if pickMode != "player" {
			http.Error(w, "game does not allow player picks", http.StatusForbidden)
			return
		}
		if roundStatus != "open" {
			http.Error(w, "round is closed", http.StatusBadRequest)
			return
		}

		var playerName string
		var isActive bool
		err = db.QueryRow(`SELECT player_name, is_active FROM managed_participants WHERE game_id=$1 AND user_id=$2`,
			gameID, claims.UserID).Scan(&playerName, &isActive)
		if err == sql.ErrNoRows {
			http.Error(w, "not a participant", http.StatusForbidden)
			return
		}
		if !isActive {
			http.Error(w, "you have been eliminated", http.StatusBadRequest)
			return
		}

		var req struct {
			TeamID int `json:"teamId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TeamID == 0 {
			http.Error(w, "teamId required", http.StatusBadRequest)
			return
		}

		// Verify team not already used in closed rounds
		var usedCount int
		db.QueryRow(`
			SELECT COUNT(*) FROM managed_picks p
			JOIN managed_rounds r ON r.id=p.round_id
			WHERE p.game_id=$1 AND p.player_name=$2 AND p.team_id=$3 AND r.status='closed'
		`, gameID, playerName, req.TeamID).Scan(&usedCount)
		if usedCount > 0 {
			http.Error(w, "team already used in a previous round", http.StatusBadRequest)
			return
		}

		db.Exec(`
			INSERT INTO managed_picks (game_id, round_id, player_name, team_id, auto_assigned)
			VALUES ($1,$2,$3,$4,false)
			ON CONFLICT (game_id,round_id,player_name)
			DO UPDATE SET team_id=EXCLUDED.team_id, auto_assigned=false
		`, gameID, roundID, playerName, req.TeamID)

		w.WriteHeader(http.StatusNoContent)
	}
}
