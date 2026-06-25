package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	_ "modernc.org/sqlite"
)

type Difficulty string

const (
	DifficultyExtreme Difficulty = "extreme"
	DifficultyExpert  Difficulty = "expert"
	DifficultyMaster  Difficulty = "master"
)

type SudokuBoard struct {
	ID         int        `json:"id,omitempty"`
	Board      [][]int    `json:"board"`
	Solution   [][]int    `json:"solution"`
	Difficulty Difficulty `json:"difficulty,omitempty"`
	Completed  bool       `json:"completed"`
}

type PuzzleSummary struct {
	ID          int    `json:"id"`
	Difficulty  string `json:"difficulty"`
	CreatedAt   string `json:"created_at"`
	HasSolution bool   `json:"has_solution"`
}

// CellValue accepts an integer 0-9 or the string "-" (treated as 0/empty)
type CellValue int

func (c *CellValue) UnmarshalJSON(data []byte) error {
	s := strings.TrimSpace(string(data))
	if s == `"-"` {
		*c = 0
		return nil
	}
	var n int
	if err := json.Unmarshal(data, &n); err != nil {
		return fmt.Errorf("cell must be 0-9 or \"-\": %w", err)
	}
	*c = CellValue(n)
	return nil
}

type InputPuzzle struct {
	Difficulty Difficulty      `json:"difficulty"`
	Blocks     [9][9]CellValue `json:"blocks"`
}

type InputSolution struct {
	ID             int             `json:"id"`
	SolutionBlocks [9][9]CellValue `json:"solution_blocks"`
}

var (
	currentBoard SudokuBoard
	db           *sql.DB
)

// blocksToBoard converts 9 block-ordered arrays into a standard 9x9 row-major board.
// Block order: top-left, top-mid, top-right, mid-left, mid-mid, mid-right, bot-left, bot-mid, bot-right.
// Within each block: left-to-right, top-to-bottom.
func blocksToBoard(blocks [9][9]CellValue) [][]int {
	board := make([][]int, 9)
	for i := range board {
		board[i] = make([]int, 9)
	}
	for b := 0; b < 9; b++ {
		blockRow := b / 3
		blockCol := b % 3
		for i := 0; i < 9; i++ {
			row := blockRow*3 + i/3
			col := blockCol*3 + i%3
			board[row][col] = int(blocks[b][i])
		}
	}
	return board
}

func initDB(path string) *sql.DB {
	database, err := sql.Open("sqlite", path)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	_, err = database.Exec(`CREATE TABLE IF NOT EXISTS puzzles (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		difficulty TEXT NOT NULL CHECK(difficulty IN ('extreme','expert','master')),
		board      TEXT NOT NULL,
		solution   TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		log.Fatalf("create table: %v", err)
	}
	// migration: ignore error if column already exists
	database.Exec(`ALTER TABLE puzzles ADD COLUMN multiple_solutions INTEGER NOT NULL DEFAULT 0`)
	return database
}

func copyBoard(board [][]int) [][]int {
	cp := make([][]int, 9)
	for i := range board {
		cp[i] = make([]int, 9)
		copy(cp[i], board[i])
	}
	return cp
}

func isValid(board [][]int, row, col, num int) bool {
	for i := 0; i < 9; i++ {
		if board[row][i] == num || board[i][col] == num {
			return false
		}
	}
	br, bc := (row/3)*3, (col/3)*3
	for r := br; r < br+3; r++ {
		for c := bc; c < bc+3; c++ {
			if board[r][c] == num {
				return false
			}
		}
	}
	return true
}

// solveSudoku returns the first solution found and a count capped at 2.
func solveSudoku(board [][]int) ([][]int, int) {
	var first [][]int
	count := 0
	var bt func(b [][]int) bool
	bt = func(b [][]int) bool {
		for r := 0; r < 9; r++ {
			for c := 0; c < 9; c++ {
				if b[r][c] == 0 {
					for num := 1; num <= 9; num++ {
						if isValid(b, r, c, num) {
							b[r][c] = num
							if bt(b) {
								return true // already capped at 2
							}
							b[r][c] = 0
						}
					}
					return false
				}
			}
		}
		// board full — found a solution
		count++
		if first == nil {
			first = copyBoard(b)
		}
		return count >= 2
	}
	bt(copyBoard(board))
	return first, count
}

func handleInput(database *sql.DB) {
	var input InputPuzzle
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		log.Fatalf("invalid input JSON: %v", err)
	}
	board := blocksToBoard(input.Blocks)
	boardJSON, _ := json.Marshal(board)

	// duplicate check
	var id int64
	err := database.QueryRow(`SELECT id FROM puzzles WHERE board = ?`, string(boardJSON)).Scan(&id)
	if err == sql.ErrNoRows {
		result, err := database.Exec(
			`INSERT INTO puzzles (difficulty, board) VALUES (?, ?)`,
			string(input.Difficulty), string(boardJSON),
		)
		if err != nil {
			log.Fatalf("insert failed: %v", err)
		}
		id, _ = result.LastInsertId()
		fmt.Printf("Inserted puzzle ID=%d\n", id)
	} else if err != nil {
		log.Fatalf("duplicate check failed: %v", err)
	} else {
		fmt.Printf("Puzzle already exists as ID=%d — updating solution.\n", id)
	}

	solution, count := solveSudoku(board)
	switch {
	case count == 0:
		fmt.Println("No solution found — puzzle may be invalid or unsolvable.")
	case count == 1:
		solJSON, _ := json.Marshal(solution)
		database.Exec(`UPDATE puzzles SET solution=?, multiple_solutions=0 WHERE id=?`, string(solJSON), id)
		fmt.Println("Solution found and stored.")
	default:
		solJSON, _ := json.Marshal(solution)
		database.Exec(`UPDATE puzzles SET solution=?, multiple_solutions=1 WHERE id=?`, string(solJSON), id)
		fmt.Println("Warning: multiple solutions found — first solution stored (multiple_solutions=1).")
	}
}

func handleSolution(database *sql.DB) {
	var input InputSolution
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		log.Fatalf("invalid solution JSON: %v", err)
	}
	solution := blocksToBoard(input.SolutionBlocks)
	solutionJSON, _ := json.Marshal(solution)
	result, err := database.Exec(
		`UPDATE puzzles SET solution=? WHERE id=?`,
		string(solutionJSON), input.ID,
	)
	if err != nil {
		log.Fatalf("update failed: %v", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		log.Fatalf("no puzzle found with ID=%d", input.ID)
	}
	fmt.Printf("Updated solution for puzzle ID=%d\n", input.ID)
}

func generateSudoku(w http.ResponseWriter, r *http.Request) {
	currentBoard = generateNewSudoku()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(currentBoard)
}

func checkSolution(w http.ResponseWriter, r *http.Request) {
	var userSolution SudokuBoard
	_ = json.NewDecoder(r.Body).Decode(&userSolution)

	w.Header().Set("Content-Type", "application/json")
	if currentBoard.Solution == nil {
		json.NewEncoder(w).Encode(false)
		return
	}
	json.NewEncoder(w).Encode(compareBoards(currentBoard.Solution, userSolution.Board))
}

func randomPuzzleHandler(w http.ResponseWriter, r *http.Request) {
	difficulty := r.URL.Query().Get("difficulty")
	if difficulty == "" {
		http.Error(w, "difficulty required", http.StatusBadRequest)
		return
	}
	var id int
	var boardJSON string
	var solutionJSON sql.NullString
	err := db.QueryRow(
		`SELECT id, board, solution FROM puzzles WHERE difficulty=? ORDER BY RANDOM() LIMIT 1`,
		difficulty,
	).Scan(&id, &boardJSON, &solutionJSON)
	if err == sql.ErrNoRows {
		http.Error(w, "no puzzles found for difficulty: "+difficulty, http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("db query error: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	var board [][]int
	json.Unmarshal([]byte(boardJSON), &board)
	var solution [][]int
	if solutionJSON.Valid && solutionJSON.String != "" {
		json.Unmarshal([]byte(solutionJSON.String), &solution)
	}
	puzzle := SudokuBoard{
		ID:         id,
		Board:      board,
		Solution:   solution,
		Difficulty: Difficulty(difficulty),
		Completed:  false,
	}
	currentBoard = puzzle
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(puzzle)
}

func searchHandler(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	difficulty := strings.TrimSpace(r.URL.Query().Get("difficulty"))

	query := `SELECT id, difficulty, created_at, solution IS NOT NULL AS has_solution FROM puzzles WHERE 1=1`
	args := []interface{}{}

	if difficulty != "" {
		query += ` AND difficulty = ?`
		args = append(args, difficulty)
	}
	if q != "" {
		query += ` AND (CAST(id AS TEXT) LIKE ? OR created_at LIKE ?)`
		like := "%" + q + "%"
		args = append(args, like, like)
	}
	query += ` ORDER BY created_at DESC`

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("search query error: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	results := []PuzzleSummary{}
	for rows.Next() {
		var s PuzzleSummary
		if err := rows.Scan(&s.ID, &s.Difficulty, &s.CreatedAt, &s.HasSolution); err != nil {
			continue
		}
		results = append(results, s)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func puzzleByIDHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.Atoi(vars["id"])
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var boardJSON string
	var solutionJSON sql.NullString
	var difficulty string
	err = db.QueryRow(
		`SELECT difficulty, board, solution FROM puzzles WHERE id=?`, id,
	).Scan(&difficulty, &boardJSON, &solutionJSON)
	if err == sql.ErrNoRows {
		http.Error(w, "puzzle not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("db query error: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	var board [][]int
	json.Unmarshal([]byte(boardJSON), &board)
	var solution [][]int
	if solutionJSON.Valid && solutionJSON.String != "" {
		json.Unmarshal([]byte(solutionJSON.String), &solution)
	}
	puzzle := SudokuBoard{
		ID:         id,
		Board:      board,
		Solution:   solution,
		Difficulty: Difficulty(difficulty),
		Completed:  false,
	}
	currentBoard = puzzle
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(puzzle)
}

func generateNewSudoku() SudokuBoard {
	board := [][]int{
		{5, 3, 0, 0, 7, 0, 0, 0, 0},
		{6, 0, 0, 1, 9, 5, 0, 0, 0},
		{0, 9, 8, 0, 0, 0, 0, 6, 0},
		{8, 0, 0, 0, 6, 0, 0, 0, 3},
		{4, 0, 0, 8, 0, 3, 0, 0, 1},
		{7, 0, 0, 0, 2, 0, 0, 0, 6},
		{0, 6, 0, 0, 0, 0, 2, 8, 0},
		{0, 0, 0, 4, 1, 9, 0, 0, 5},
		{0, 0, 0, 0, 8, 0, 0, 7, 9},
	}
	solution := [][]int{
		{5, 3, 4, 6, 7, 8, 9, 1, 2},
		{6, 7, 2, 1, 9, 5, 3, 4, 8},
		{1, 9, 8, 3, 4, 2, 5, 6, 7},
		{8, 5, 9, 7, 6, 1, 4, 2, 3},
		{4, 2, 6, 8, 5, 3, 7, 9, 1},
		{7, 1, 3, 9, 2, 4, 8, 5, 6},
		{9, 6, 1, 5, 3, 7, 2, 8, 4},
		{2, 8, 7, 4, 1, 9, 6, 3, 5},
		{3, 4, 5, 2, 8, 6, 1, 7, 9},
	}
	return SudokuBoard{Board: board, Solution: solution, Completed: false}
}

func compareBoards(board1, board2 [][]int) bool {
	for i := 0; i < 9; i++ {
		for j := 0; j < 9; j++ {
			if board1[i][j] != board2[i][j] {
				return false
			}
		}
	}
	return true
}

func main() {
	inputMode := flag.Bool("input", false, "read puzzle JSON from stdin and store in DB")
	solutionMode := flag.Bool("solution", false, "read solution JSON from stdin and update DB puzzle by id")
	flag.Parse()

	rand.Seed(time.Now().UnixNano())
	db = initDB("./puzzles.sqlite")
	defer db.Close()

	if *inputMode {
		handleInput(db)
		return
	}
	if *solutionMode {
		handleSolution(db)
		return
	}

	router := mux.NewRouter()
	router.PathPrefix("/game/").Handler(http.StripPrefix("/game/", http.FileServer(http.Dir("./static/"))))
	router.HandleFunc("/api/generate", generateSudoku).Methods("GET")
	router.HandleFunc("/api/check", checkSolution).Methods("POST")
	router.HandleFunc("/api/puzzles/random", randomPuzzleHandler).Methods("GET")
	router.HandleFunc("/api/puzzles/{id:[0-9]+}", puzzleByIDHandler).Methods("GET")
	router.HandleFunc("/api/search", searchHandler).Methods("GET")

	log.Println("Server running at http://localhost:8080/game/sudoku.html")
	log.Fatal(http.ListenAndServe(":8080", router))
}
