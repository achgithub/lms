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

func HandleListPlayers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())

		rows, err := db.Query(`
			SELECT id, manager_id, user_id, name, created_at
			FROM managed_players WHERE manager_id=$1 ORDER BY name
		`, claims.UserID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		players := []models.Player{}
		for rows.Next() {
			var p models.Player
			var userID sql.NullInt64
			if err := rows.Scan(&p.ID, &p.ManagerID, &userID, &p.Name, &p.CreatedAt); err != nil {
				continue
			}
			if userID.Valid {
				v := int(userID.Int64)
				p.UserID = &v
			}
			players = append(players, p)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"players": players})
	}
}

func HandleCreatePlayer(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())

		var req models.CreatePlayerRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
			http.Error(w, "name required", http.StatusBadRequest)
			return
		}

		var id int
		err := db.QueryRow(`
			INSERT INTO managed_players (manager_id, user_id, name) VALUES ($1,$2,$3) RETURNING id
		`, claims.UserID, req.UserID, req.Name).Scan(&id)
		if err != nil {
			http.Error(w, "failed to create player (name may already exist)", http.StatusConflict)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"id": id})
	}
}

func HandleDeletePlayer(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		id, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		result, err := db.Exec(`DELETE FROM managed_players WHERE id=$1 AND manager_id=$2`, id, claims.UserID)
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
