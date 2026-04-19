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

func HandleListGroups(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())

		rows, err := db.Query(`
			SELECT g.id, g.manager_id, g.name, g.created_at,
				COALESCE(COUNT(t.id), 0) as team_count
			FROM managed_groups g
			LEFT JOIN managed_teams t ON t.group_id = g.id
			WHERE g.manager_id = $1
			GROUP BY g.id
			ORDER BY g.created_at DESC
		`, claims.UserID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		groups := []models.GroupWithTeamCount{}
		for rows.Next() {
			var g models.GroupWithTeamCount
			if err := rows.Scan(&g.ID, &g.ManagerID, &g.Name, &g.CreatedAt, &g.TeamCount); err != nil {
				continue
			}
			groups = append(groups, g)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"groups": groups})
	}
}

func HandleCreateGroup(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())

		var req models.CreateGroupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
			http.Error(w, "name required", http.StatusBadRequest)
			return
		}

		var id int
		err := db.QueryRow(`INSERT INTO managed_groups (manager_id, name) VALUES ($1,$2) RETURNING id`,
			claims.UserID, req.Name).Scan(&id)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"id": id})
	}
}

func HandleDeleteGroup(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		id, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		result, err := db.Exec(`DELETE FROM managed_groups WHERE id=$1 AND manager_id=$2`, id, claims.UserID)
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

func HandleListTeams(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		groupID, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var count int
		db.QueryRow(`SELECT COUNT(*) FROM managed_groups WHERE id=$1 AND manager_id=$2`, groupID, claims.UserID).Scan(&count)
		if count == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		rows, err := db.Query(`SELECT id, group_id, name, created_at FROM managed_teams WHERE group_id=$1 ORDER BY name`, groupID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		teams := []models.Team{}
		for rows.Next() {
			var t models.Team
			if err := rows.Scan(&t.ID, &t.GroupID, &t.Name, &t.CreatedAt); err != nil {
				continue
			}
			teams = append(teams, t)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"teams": teams})
	}
}

func HandleCreateTeam(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		groupID, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var count int
		db.QueryRow(`SELECT COUNT(*) FROM managed_groups WHERE id=$1 AND manager_id=$2`, groupID, claims.UserID).Scan(&count)
		if count == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		var req models.CreateTeamRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
			http.Error(w, "name required", http.StatusBadRequest)
			return
		}

		var id int
		err = db.QueryRow(`INSERT INTO managed_teams (group_id, name) VALUES ($1,$2) RETURNING id`, groupID, req.Name).Scan(&id)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"id": id})
	}
}

func HandleUpdateTeam(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		id, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		var req models.UpdateTeamRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		result, err := db.Exec(`
			UPDATE managed_teams SET name=$1
			WHERE id=$2 AND group_id IN (SELECT id FROM managed_groups WHERE manager_id=$3)
		`, req.Name, id, claims.UserID)
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

func HandleDeleteTeam(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		id, err := strconv.Atoi(mux.Vars(r)["id"])
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}

		result, err := db.Exec(`
			DELETE FROM managed_teams WHERE id=$1
			AND group_id IN (SELECT id FROM managed_groups WHERE manager_id=$2)
		`, id, claims.UserID)
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
