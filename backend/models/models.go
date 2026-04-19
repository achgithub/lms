package models

import "time"

type Role string

const (
	RoleAdmin   Role = "admin"
	RoleManager Role = "manager"
	RoleGames   Role = "games"
	RoleReports Role = "reports"
	RolePlayer  Role = "player"
)

type User struct {
	ID           int       `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	Role         Role      `json:"role"`
	MustChangePW bool      `json:"mustChangePw"`
	IsActive     bool      `json:"isActive"`
	CreatedAt    time.Time `json:"createdAt"`
	CreatedBy    *int      `json:"createdBy,omitempty"`
}

type Group struct {
	ID        int       `json:"id"`
	ManagerID int       `json:"managerId"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type GroupWithTeamCount struct {
	Group
	TeamCount int `json:"teamCount"`
}

type Team struct {
	ID        int       `json:"id"`
	GroupID   int       `json:"groupId"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type Player struct {
	ID        int       `json:"id"`
	ManagerID int       `json:"managerId"`
	UserID    *int      `json:"userId,omitempty"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type Game struct {
	ID             int       `json:"id"`
	ManagerID      int       `json:"managerId"`
	Name           string    `json:"name"`
	GroupID        int       `json:"groupId"`
	Status         string    `json:"status"`
	WinnerName     *string   `json:"winnerName,omitempty"`
	PostponeAsWin  bool      `json:"postponeAsWin"`
	WinnerMode     string    `json:"winnerMode"`
	RolloverMode   string    `json:"rolloverMode"`
	MaxWinners     int       `json:"maxWinners"`
	PickMode       string    `json:"pickMode"`
	CreatedAt      time.Time `json:"createdAt"`
}

type GameWithDetails struct {
	Game
	GroupName        string `json:"groupName"`
	ParticipantCount int    `json:"participantCount"`
	CurrentRound     int    `json:"currentRound"`
}

type Participant struct {
	ID                 int       `json:"id"`
	GameID             int       `json:"gameId"`
	UserID             *int      `json:"userId,omitempty"`
	PlayerName         string    `json:"playerName"`
	IsActive           bool      `json:"isActive"`
	EliminatedInRound  *int      `json:"eliminatedInRound,omitempty"`
	CreatedAt          time.Time `json:"createdAt"`
}

type Round struct {
	ID          int       `json:"id"`
	GameID      int       `json:"gameId"`
	RoundNumber int       `json:"roundNumber"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Pick struct {
	ID           int       `json:"id"`
	GameID       int       `json:"gameId"`
	RoundID      int       `json:"roundId"`
	PlayerName   string    `json:"playerName"`
	TeamID       *int      `json:"teamId,omitempty"`
	FixtureID    *int      `json:"fixtureId,omitempty"`
	PickedSide   *string   `json:"pickedSide,omitempty"`
	Result       *string   `json:"result,omitempty"`
	AutoAssigned bool      `json:"autoAssigned"`
	CreatedAt    time.Time `json:"createdAt"`
}

type PickWithTeamName struct {
	Pick
	TeamName string `json:"teamName"`
}

// Request types

type CreateGroupRequest struct {
	Name string `json:"name"`
}

type CreateTeamRequest struct {
	Name string `json:"name"`
}

type UpdateTeamRequest struct {
	Name string `json:"name"`
}

type CreatePlayerRequest struct {
	Name   string `json:"name"`
	UserID *int   `json:"userId,omitempty"`
}

type CreateGameRequest struct {
	Name          string   `json:"name"`
	GroupID       int      `json:"groupId"`
	PlayerNames   []string `json:"playerNames"`
	PostponeAsWin bool     `json:"postponeAsWin"`
	WinnerMode    string   `json:"winnerMode"`
	RolloverMode  string   `json:"rolloverMode"`
	MaxWinners    int      `json:"maxWinners"`
	PickMode      string   `json:"pickMode"`
}

type PickItem struct {
	PlayerName string  `json:"playerName"`
	TeamID     *int    `json:"teamId"`
	FixtureID  *int    `json:"fixtureId"`
	PickedSide *string `json:"pickedSide"`
}

type SavePicksRequest struct {
	Picks []PickItem `json:"picks"`
}

type ResultItem struct {
	PickID int    `json:"pickId"`
	Result string `json:"result"`
}

type SaveResultsRequest struct {
	Results []ResultItem `json:"results"`
}

type Claims struct {
	UserID       int    `json:"user_id"`
	Email        string `json:"email"`
	Name         string `json:"name"`
	Role         Role   `json:"role"`
	MustChangePW bool   `json:"must_change_pw"`
}
