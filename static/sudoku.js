// ── Board rendering ──────────────────────────────────────────────

function renderBoard(board) {
  const sudokuBoard = document.getElementById("sudoku-board");
  sudokuBoard.innerHTML = "";

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
        cell.maxLength = 1;
        cell.addEventListener("beforeinput", (e) => {
          if (e.data !== null && !/^[1-9]$/.test(e.data)) e.preventDefault();
        });
        cell.addEventListener("input", () => {
          const clean = cell.value.replace(/[^1-9]/g, "").slice(0, 1);
          if (cell.value !== clean) cell.value = clean;
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

function setStatus(msg, isError) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.className = isError ? "error" : "";
}

// ── API actions ───────────────────────────────────────────────────

async function generateNewPuzzle() {
  const response = await fetch("/api/generate");
  const data = await response.json();
  renderBoard(data.board);
  setStatus("");
}

async function checkSolution() {
  const board = getBoardState();
  const response = await fetch("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ board }),
  });
  const isCorrect = await response.json();
  if (isCorrect) {
    setStatus("Correct! Puzzle solved!");
  } else {
    setStatus("Not quite right — keep going!", true);
  }
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

// ── Conflict / highlight logic ────────────────────────────────────

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

// ── Modal ─────────────────────────────────────────────────────────

function openModal() {
  document.getElementById("puzzle-modal").classList.remove("hidden");
  document.getElementById("search-input").value = "";
  document.querySelector('input[name="diff"][value=""]').checked = true;
  runSearch();
  setTimeout(() => document.getElementById("search-input").focus(), 50);
}

function closeModal() {
  document.getElementById("puzzle-modal").classList.add("hidden");
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById("puzzle-modal")) closeModal();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// ── Search ────────────────────────────────────────────────────────

let searchTimer = null;

function debouncedSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
}

async function runSearch() {
  const q = document.getElementById("search-input").value.trim();
  const difficulty = document.querySelector('input[name="diff"]:checked').value;

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (difficulty) params.set("difficulty", difficulty);

  const response = await fetch("/api/search?" + params.toString());
  if (!response.ok) return;
  const results = await response.json();
  renderResults(results);
}

function renderResults(results) {
  const container = document.getElementById("search-results");
  container.innerHTML = "";

  if (!results || results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "result-empty";
    empty.textContent = "No puzzles found.";
    container.appendChild(empty);
    return;
  }

  for (const p of results) {
    const row = document.createElement("div");
    row.className = "result-row";
    row.onclick = () => loadPuzzleById(p.id);

    const date = new Date(p.created_at + "Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });

    const badge = document.createElement("span");
    badge.className = `diff-badge diff-${p.difficulty}`;
    badge.textContent = p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1);

    const meta = document.createElement("span");
    meta.className = "result-meta";
    meta.textContent = `#${p.id} · ${date}`;

    const sol = document.createElement("span");
    sol.className = p.has_solution ? "sol-yes" : "sol-no";
    sol.textContent = p.has_solution ? "✓ solution" : "no solution";

    row.appendChild(meta);
    row.appendChild(badge);
    row.appendChild(sol);
    container.appendChild(row);
  }
}

async function loadPuzzleById(id) {
  const response = await fetch(`/api/puzzles/${id}`);
  if (!response.ok) {
    setStatus("Failed to load puzzle #" + id, true);
    return;
  }
  const data = await response.json();
  renderBoard(data.board);
  const hasSol = data.solution && data.solution.length > 0;
  setStatus(
    `Loaded #${data.id} · ${data.difficulty}${hasSol ? "" : " (no solution stored)"}`
  );
  closeModal();
}
