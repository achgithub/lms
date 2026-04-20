package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"

	dbpkg "github.com/andrewharris/lms/db"
	"github.com/andrewharris/lms/handlers"
	"github.com/andrewharris/lms/middleware"
	"github.com/andrewharris/lms/models"
	"github.com/gorilla/mux"
	"github.com/rs/cors"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	database, err := dbpkg.Connect()
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer database.Close()

	if err := dbpkg.AutoMigrate(database); err != nil {
		log.Fatalf("auto-migrate: %v", err)
	}
	seedAdmin(database)

	r := mux.NewRouter()

	// Health
	r.HandleFunc("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}).Methods("GET")

	// Auth (unauthenticated)
	r.HandleFunc("/api/auth/login", handlers.HandleLogin(database)).Methods("POST")
	r.Handle("/api/auth/change-password",
		middleware.Auth(http.HandlerFunc(handlers.HandleChangePassword(database)))).Methods("POST")

	// Admin routes
	adminMW := middleware.RequireRole(models.RoleAdmin)
	r.Handle("/api/admin/users", adminMW(http.HandlerFunc(handlers.HandleListUsers(database)))).Methods("GET")
	r.Handle("/api/admin/users", adminMW(http.HandlerFunc(handlers.HandleCreateUser(database)))).Methods("POST")
	r.Handle("/api/admin/users/{id}", adminMW(http.HandlerFunc(handlers.HandleUpdateUser(database)))).Methods("PUT")
	r.Handle("/api/admin/users/{id}", adminMW(http.HandlerFunc(handlers.HandleDeleteUser(database)))).Methods("DELETE")
	r.Handle("/api/admin/reports", adminMW(http.HandlerFunc(handlers.HandleAdminReports(database)))).Methods("GET")

	// Fixture routes (manager only)
	managerMW := middleware.RequireRole(models.RoleManager)
	r.Handle("/api/fixtures/competitions", managerMW(http.HandlerFunc(handlers.HandleListCompetitions()))).Methods("GET")
	r.Handle("/api/fixtures/teams", managerMW(http.HandlerFunc(handlers.HandleGetCompetitionTeams()))).Methods("GET")
	r.Handle("/api/fixtures/import", managerMW(http.HandlerFunc(handlers.HandleImportFixture(database)))).Methods("POST")
	r.Handle("/api/fixtures/matches", managerMW(http.HandlerFunc(handlers.HandleListFixtures(database)))).Methods("GET")
	r.Handle("/api/fixtures/import-matches", managerMW(http.HandlerFunc(handlers.HandleImportMatches(database)))).Methods("POST")
	r.Handle("/api/fixtures/update-results", managerMW(http.HandlerFunc(handlers.HandleUpdateResults(database)))).Methods("POST")
	r.Handle("/api/fixtures/{id}/result", managerMW(http.HandlerFunc(handlers.HandleManualFixtureResult(database)))).Methods("PUT")

	// Manager/games routes (manager or games role)
	gamesMW := middleware.RequireRole(models.RoleManager, models.RoleGames)
	r.Handle("/api/fixtures/by-date", gamesMW(http.HandlerFunc(handlers.HandleListFixturesByDate(database)))).Methods("GET")
	r.Handle("/api/groups", gamesMW(http.HandlerFunc(handlers.HandleListGroups(database)))).Methods("GET")
	r.Handle("/api/groups", managerMW(http.HandlerFunc(handlers.HandleCreateGroup(database)))).Methods("POST")
	r.Handle("/api/groups/{id}", managerMW(http.HandlerFunc(handlers.HandleUpdateGroup(database)))).Methods("PUT")
	r.Handle("/api/groups/{id}", managerMW(http.HandlerFunc(handlers.HandleDeleteGroup(database)))).Methods("DELETE")
	r.Handle("/api/groups/{id}/teams", gamesMW(http.HandlerFunc(handlers.HandleListTeams(database)))).Methods("GET")
	r.Handle("/api/groups/{id}/teams", managerMW(http.HandlerFunc(handlers.HandleCreateTeam(database)))).Methods("POST")
	r.Handle("/api/teams/{id}", managerMW(http.HandlerFunc(handlers.HandleUpdateTeam(database)))).Methods("PUT")
	r.Handle("/api/teams/{id}", managerMW(http.HandlerFunc(handlers.HandleDeleteTeam(database)))).Methods("DELETE")
	r.Handle("/api/players", managerMW(http.HandlerFunc(handlers.HandleListPlayers(database)))).Methods("GET")
	r.Handle("/api/players", managerMW(http.HandlerFunc(handlers.HandleCreatePlayer(database)))).Methods("POST")
	r.Handle("/api/players/{id}", managerMW(http.HandlerFunc(handlers.HandleDeletePlayer(database)))).Methods("DELETE")
	r.Handle("/api/games", gamesMW(http.HandlerFunc(handlers.HandleListGames(database)))).Methods("GET")
	r.Handle("/api/games", managerMW(http.HandlerFunc(handlers.HandleCreateGame(database)))).Methods("POST")
	r.Handle("/api/games/{id}", gamesMW(http.HandlerFunc(handlers.HandleGetGame(database)))).Methods("GET")
	r.Handle("/api/games/{id}", managerMW(http.HandlerFunc(handlers.HandleDeleteGame(database)))).Methods("DELETE")
	r.Handle("/api/games/{id}/advance", managerMW(http.HandlerFunc(handlers.HandleAdvanceRound(database)))).Methods("POST")
	r.Handle("/api/games/{id}/declare-winners", managerMW(http.HandlerFunc(handlers.HandleDeclareWinners(database)))).Methods("POST")
	r.Handle("/api/games/{id}/used-teams", gamesMW(http.HandlerFunc(handlers.HandleGetUsedTeams(database)))).Methods("GET")
	r.Handle("/api/games/{id}/participants", gamesMW(http.HandlerFunc(handlers.HandleAddParticipants(database)))).Methods("POST")
	r.Handle("/api/rounds/{roundId}/picks", gamesMW(http.HandlerFunc(handlers.HandleGetRoundPicks(database)))).Methods("GET")
	r.Handle("/api/rounds/{roundId}/picks", gamesMW(http.HandlerFunc(handlers.HandleSavePicks(database)))).Methods("POST")
	r.Handle("/api/rounds/{roundId}/scope", gamesMW(http.HandlerFunc(handlers.HandleGetRoundScope(database)))).Methods("GET")
	r.Handle("/api/rounds/{roundId}/scope", gamesMW(http.HandlerFunc(handlers.HandleSetRoundScope(database)))).Methods("POST")
	r.Handle("/api/rounds/{roundId}/apply-results", managerMW(http.HandlerFunc(handlers.HandleApplyFixtureResults(database)))).Methods("POST")
	r.Handle("/api/rounds/{roundId}/finalize-picks", gamesMW(http.HandlerFunc(handlers.HandleFinalizePicks(database)))).Methods("POST")
	r.Handle("/api/rounds/{roundId}/results", gamesMW(http.HandlerFunc(handlers.HandleSaveResults(database)))).Methods("POST")
	r.Handle("/api/rounds/{roundId}/close", gamesMW(http.HandlerFunc(handlers.HandleCloseRound(database)))).Methods("POST")
	r.Handle("/api/rounds/{roundId}/reopen", gamesMW(http.HandlerFunc(handlers.HandleReopenRound(database)))).Methods("POST")

	// Reports
	reportsMW := middleware.RequireRole(models.RoleManager, models.RoleGames, models.RoleReports)
	r.Handle("/api/report/{gameId}", reportsMW(http.HandlerFunc(handlers.HandleGetReport(database)))).Methods("GET")

	// Player routes
	playerMW := middleware.RequireRole(models.RolePlayer)
	r.Handle("/api/player/games", playerMW(http.HandlerFunc(handlers.HandlePlayerListGames(database)))).Methods("GET")
	r.Handle("/api/player/games/{id}", playerMW(http.HandlerFunc(handlers.HandlePlayerGetGame(database)))).Methods("GET")
	r.Handle("/api/player/rounds/{roundId}/pick", playerMW(http.HandlerFunc(handlers.HandlePlayerSavePick(database)))).Methods("POST")

	// SPA static files
	staticPath := getEnv("STATIC_PATH", "./static")
	if _, err := os.Stat(staticPath); err == nil {
		r.PathPrefix("/").Handler(spaHandler{root: staticPath})
		log.Printf("serving static files from %s", staticPath)
	}

	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders: []string{"*"},
	})

	port := getEnv("PORT", "8080")
	log.Printf("LMS server starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, c.Handler(r)))
}

func seedAdmin(db *sql.DB) {
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin'`).Scan(&count)
	if count > 0 {
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("changeme"), 10)
	if err != nil {
		log.Printf("seedAdmin: bcrypt error: %v", err)
		return
	}
	_, err = db.Exec(`
		INSERT INTO users (email, name, role, password_hash, must_change_pw)
		VALUES ('admin@lms.local', 'Admin', 'admin', $1, true)
		ON CONFLICT (email) DO NOTHING
	`, string(hash))
	if err != nil {
		log.Printf("seedAdmin: insert error: %v", err)
		return
	}
	log.Println("seeded admin user: admin@lms.local / changeme")
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// spaHandler serves the React SPA, falling back to index.html for unknown paths
type spaHandler struct {
	root string
}

func (h spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := h.root + r.URL.Path
	if _, err := os.Stat(path); os.IsNotExist(err) {
		http.ServeFile(w, r, h.root+"/index.html")
		return
	}
	http.FileServer(http.Dir(h.root)).ServeHTTP(w, r)
}
