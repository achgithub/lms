package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/andrewharris/lms/middleware"
	"github.com/andrewharris/lms/models"
	"github.com/gorilla/mux"
	"golang.org/x/crypto/bcrypt"
)

type createUserRequest struct {
	Email    string      `json:"email"`
	Name     string      `json:"name"`
	Role     models.Role `json:"role"`
	Password string      `json:"password"`
}

type updateUserRequest struct {
	Name     string      `json:"name"`
	Role     models.Role `json:"role"`
	IsActive bool        `json:"isActive"`
}

func HandleListUsers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(`
			SELECT id, email, name, role, must_change_pw, is_active, created_at
			FROM users ORDER BY created_at DESC
		`)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		users := []models.User{}
		for rows.Next() {
			var u models.User
			if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.MustChangePW, &u.IsActive, &u.CreatedAt); err != nil {
				continue
			}
			users = append(users, u)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"users": users})
	}
}

func HandleCreateUser(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())

		var req createUserRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if req.Email == "" || req.Name == "" || req.Password == "" {
			http.Error(w, "email, name, and password required", http.StatusBadRequest)
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 10)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		var userID int
		err = db.QueryRow(`
			INSERT INTO users (email, name, role, password_hash, must_change_pw, created_by)
			VALUES ($1, $2, $3, $4, true, $5) RETURNING id
		`, req.Email, req.Name, req.Role, string(hash), claims.UserID).Scan(&userID)
		if err != nil {
			http.Error(w, "failed to create user (email may already exist)", http.StatusConflict)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]int{"id": userID})
	}
}

func HandleUpdateUser(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var req updateUserRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		result, err := db.Exec(`
			UPDATE users SET name = $1, role = $2, is_active = $3 WHERE id = $4
		`, req.Name, req.Role, req.IsActive, id)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			http.Error(w, "user not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleDeleteUser(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		id, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}
		if id == claims.UserID {
			http.Error(w, "cannot delete yourself", http.StatusBadRequest)
			return
		}

		result, err := db.Exec(`DELETE FROM users WHERE id = $1`, id)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		if n, _ := result.RowsAffected(); n == 0 {
			http.Error(w, "user not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleAdminReports(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(`
			SELECT
				g.id, g.name, g.status, g.winner_name, g.pick_mode, g.created_at,
				u.name as manager_name,
				gr.name as group_name,
				COALESCE(COUNT(DISTINCT p.id), 0) as participant_count,
				COALESCE(MAX(r.round_number), 0) as current_round
			FROM managed_games g
			JOIN users u ON u.id = g.manager_id
			LEFT JOIN managed_groups gr ON gr.id = g.group_id
			LEFT JOIN managed_participants p ON p.game_id = g.id
			LEFT JOIN managed_rounds r ON r.game_id = g.id
			GROUP BY g.id, u.name, gr.name
			ORDER BY g.created_at DESC
		`)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type AdminGameRow struct {
			ID               int     `json:"id"`
			Name             string  `json:"name"`
			Status           string  `json:"status"`
			WinnerName       *string `json:"winnerName,omitempty"`
			PickMode         string  `json:"pickMode"`
			ManagerName      string  `json:"managerName"`
			GroupName        string  `json:"groupName"`
			ParticipantCount int     `json:"participantCount"`
			CurrentRound     int     `json:"currentRound"`
		}

		games := []AdminGameRow{}
		for rows.Next() {
			var g AdminGameRow
			var winner sql.NullString
			var createdAt interface{}
			if err := rows.Scan(&g.ID, &g.Name, &g.Status, &winner, &g.PickMode, &createdAt,
				&g.ManagerName, &g.GroupName, &g.ParticipantCount, &g.CurrentRound); err != nil {
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
