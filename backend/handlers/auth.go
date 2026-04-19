package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/andrewharris/lms/middleware"
	"github.com/andrewharris/lms/models"
	"golang.org/x/crypto/bcrypt"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func HandleLogin(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		var user models.User
		var hash string
		err := db.QueryRow(`
			SELECT id, email, name, role, password_hash, must_change_pw, is_active
			FROM users WHERE email = $1
		`, req.Email).Scan(&user.ID, &user.Email, &user.Name, &user.Role, &hash, &user.MustChangePW, &user.IsActive)
		if err == sql.ErrNoRows {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		if !user.IsActive {
			http.Error(w, "account disabled", http.StatusUnauthorized)
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}

		token, err := middleware.IssueToken(user)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"token": token,
			"user": map[string]interface{}{
				"id":           user.ID,
				"email":        user.Email,
				"name":         user.Name,
				"role":         user.Role,
				"mustChangePw": user.MustChangePW,
			},
		})
	}
}

func HandleChangePassword(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := middleware.ClaimsFromContext(r.Context())
		if claims == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req changePasswordRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if len(req.NewPassword) < 8 {
			http.Error(w, "password must be at least 8 characters", http.StatusBadRequest)
			return
		}

		var currentHash string
		var user models.User
		err := db.QueryRow(`
			SELECT id, email, name, role, password_hash, is_active
			FROM users WHERE id = $1
		`, claims.UserID).Scan(&user.ID, &user.Email, &user.Name, &user.Role, &currentHash, &user.IsActive)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.CurrentPassword)); err != nil {
			http.Error(w, "current password incorrect", http.StatusUnauthorized)
			return
		}

		newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), 10)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		_, err = db.Exec(`UPDATE users SET password_hash = $1, must_change_pw = false WHERE id = $2`,
			string(newHash), claims.UserID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		user.MustChangePW = false
		token, err := middleware.IssueToken(user)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	}
}
