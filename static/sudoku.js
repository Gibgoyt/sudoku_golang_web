async function generateNewPuzzle() {
  const response = await fetch("/api/generate");
  const data = await response.json();
  console.log(data); // For debugging

  // Populate the Sudoku board with the generated puzzle
  const board = data.board;
  const sudokuBoard = document.getElementById("sudoku-board");
  sudokuBoard.innerHTML = ""; // Clear previous board

  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const cell = document.createElement("input");
      cell.type = "text";
      cell.className = "sudoku-cell";
      if (board[i][j] !== 0) {
        cell.value = board[i][j];
        cell.readOnly = true;
        cell.classList.add("prefilled");
      } else {
        cell.value = "";
        cell.classList.add("user-cell");
        cell.addEventListener("input", () => {
          highlightMatches(cell.value);
          updateConflicts();
        });
      }
      cell.addEventListener("click", () => highlightMatches(cell.value));
      sudokuBoard.appendChild(cell);
    }
  }
  updateConflicts();
}

function highlightMatches(value) {
  const cells = document.getElementsByClassName("sudoku-cell");
  for (const c of cells) c.classList.remove("highlight");
  if (!value) return;
  for (const c of cells) if (c.value === value) c.classList.add("highlight");
}

function updateConflicts() {
  const cells = document.getElementsByClassName("sudoku-cell");
  for (const c of cells) c.classList.remove("conflict");

  const get = (r, c) => cells[r * 9 + c].value.trim();
  const markUser = (r, c) => {
    const cell = cells[r * 9 + c];
    if (cell.classList.contains("user-cell")) cell.classList.add("conflict");
  };

  const checkGroup = (positions) => {
    const counts = {};
    for (const [r, c] of positions) {
      const v = get(r, c);
      if (!v) continue;
      (counts[v] ||= []).push([r, c]);
    }
    for (const v in counts) {
      if (counts[v].length > 1) {
        for (const [r, c] of counts[v]) markUser(r, c);
      }
    }
  };

  for (let r = 0; r < 9; r++) {
    checkGroup([...Array(9)].map((_, c) => [r, c]));
  }
  for (let c = 0; c < 9; c++) {
    checkGroup([...Array(9)].map((_, r) => [r, c]));
  }
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const pos = [];
      for (let i = 0; i < 9; i++) {
        pos.push([br * 3 + Math.floor(i / 3), bc * 3 + (i % 3)]);
      }
      checkGroup(pos);
    }
  }
}

async function checkSolution() {
  const board = getBoardState();
  const response = await fetch("/api/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ board }),
  });

  const isCorrect = await response.json();
  alert(isCorrect ? "Solution is correct!" : "Solution is incorrect!");
}

function getBoardState() {
  const board = [];
  const cells = document.getElementsByClassName("sudoku-cell");

  for (let i = 0; i < 9; i++) {
    const row = [];
    for (let j = 0; j < 9; j++) {
      const value = cells[i * 9 + j].value.trim();
      row.push(value === "" ? 0 : parseInt(value));
    }
    board.push(row);
  }

  return board;
}
