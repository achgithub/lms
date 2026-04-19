package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

type roundReport struct {
	RoundNumber     int               `json:"roundNumber"`
	Status          string            `json:"status"`
	ActivePlayers   int               `json:"activePlayers,omitempty"`
	TeamPicks       map[string]int    `json:"teamPicks,omitempty"`
	EliminatedCount int               `json:"eliminatedCount,omitempty"`
	ThroughCount    int               `json:"throughCount,omitempty"`
	TeamResults     map[string]string `json:"teamResults,omitempty"`
}

func HandleGetReport(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		gameID, err := strconv.Atoi(mux.Vars(r)["gameId"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var gameName, gameStatus, winnerMode, rolloverMode string
		var winnerName sql.NullString
		var postponeAsWin bool
		var maxWinners int
		err = db.QueryRow(`
			SELECT name, status, winner_name, postpone_as_win, winner_mode, rollover_mode, max_winners
			FROM managed_games WHERE id=$1
		`, gameID).Scan(&gameName, &gameStatus, &winnerName, &postponeAsWin, &winnerMode, &rolloverMode, &maxWinners)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		roundRows, err := db.Query(`SELECT id, round_number, status FROM managed_rounds WHERE game_id=$1 ORDER BY round_number`, gameID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer roundRows.Close()

		rounds := []roundReport{}
		for roundRows.Next() {
			var roundID, roundNumber int
			var roundStatus string
			roundRows.Scan(&roundID, &roundNumber, &roundStatus)

			rpt := roundReport{RoundNumber: roundNumber, Status: roundStatus}

			if roundStatus == "open" {
				db.QueryRow(`SELECT COUNT(*) FROM managed_participants WHERE game_id=$1 AND is_active=true`, gameID).Scan(&rpt.ActivePlayers)

				pickRows, err := db.Query(`
					SELECT t.name, COUNT(p.id)
					FROM managed_picks p JOIN managed_teams t ON t.id=p.team_id
					WHERE p.game_id=$1 AND p.round_id=$2 AND p.team_id IS NOT NULL
					GROUP BY t.name ORDER BY COUNT(p.id) DESC, t.name
				`, gameID, roundID)
				if err == nil {
					defer pickRows.Close()
					rpt.TeamPicks = make(map[string]int)
					for pickRows.Next() {
						var tn string
						var cnt int
						pickRows.Scan(&tn, &cnt)
						rpt.TeamPicks[tn] = cnt
					}
				}
			} else {
				db.QueryRow(`SELECT COUNT(*) FROM managed_participants WHERE game_id=$1 AND eliminated_in_round=$2`, gameID, roundNumber).Scan(&rpt.EliminatedCount)
				db.QueryRow(`SELECT COUNT(*) FROM managed_participants WHERE game_id=$1 AND (eliminated_in_round IS NULL OR eliminated_in_round>$2)`, gameID, roundNumber).Scan(&rpt.ThroughCount)

				resultRows, err := db.Query(`
					SELECT DISTINCT t.name, p.result FROM managed_picks p
					JOIN managed_teams t ON t.id=p.team_id
					WHERE p.game_id=$1 AND p.round_id=$2 AND p.result IS NOT NULL ORDER BY t.name
				`, gameID, roundID)
				if err == nil {
					defer resultRows.Close()
					rpt.TeamResults = make(map[string]string)
					for resultRows.Next() {
						var tn, res string
						resultRows.Scan(&tn, &res)
						rpt.TeamResults[tn] = res
					}
				}
			}
			rounds = append(rounds, rpt)
		}

		var startingPlayers int
		db.QueryRow(`SELECT COUNT(*) FROM managed_participants WHERE game_id=$1`, gameID).Scan(&startingPlayers)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"game": map[string]interface{}{
				"name":            gameName,
				"status":          gameStatus,
				"winnerName":      winnerName.String,
				"postponeAsWin":   postponeAsWin,
				"winnerMode":      winnerMode,
				"rolloverMode":    rolloverMode,
				"maxWinners":      maxWinners,
				"startingPlayers": startingPlayers,
			},
			"rounds": rounds,
		})
	}
}
