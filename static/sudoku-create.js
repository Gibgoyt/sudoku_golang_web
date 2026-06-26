// ── State ─────────────────────────────────────────────────────────
const cells = []; // cells[row][col] = <input>
let selectedCell = null;
let selectedR = -1;
let selectedC = -1;

// ── Board init ────────────────────────────────────────────────────
function initBoard() {
  const board = document.getElementById("sudoku-board");
  board.innerHTML = "";
  for (let r = 0; r < 9; r++) {
    cells[r] = [];
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement("input");
      cell.type = "text";
      cell.className = "sudoku-cell user-cell";
      cell.maxLength = 1;
      cell.setAttribute("inputmode", "numeric");
      cell.setAttribute("autocomplete", "off");

      cell.addEventListener("focus", () => highlightSelected(r, c));
      cell.addEventListener("click",  () => highlightSelected(r, c));
      cell.addEventListener("beforeinput", (e) => {
        if (e.data !== null && !/^[1-9]$/.test(e.data)) e.preventDefault();
      });
      cell.addEventListener("input", () => {
        const clean = cell.value.replace(/[^1-9]/g, "").slice(0, 1);
        if (cell.value !== clean) cell.value = clean;
        highlightSelected(r, c);
        updateConflicts();
      });
      cell.addEventListener("keydown", (e) => handleKeyNav(e, r, c));

      cells[r][c] = cell;
      board.appendChild(cell);
    }
  }
}

// ── Keyboard navigation ───────────────────────────────────────────
function handleKeyNav(e, r, c) {
  const moves = {
    ArrowUp:    [-1,  0],
    ArrowDown:  [ 1,  0],
    ArrowLeft:  [ 0, -1],
    ArrowRight: [ 0,  1],
  };
  if (moves[e.key]) {
    e.preventDefault();
    const [dr, dc] = moves[e.key];
    const nr = Math.max(0, Math.min(8, r + dr));
    const nc = Math.max(0, Math.min(8, c + dc));
    cells[nr][nc].focus();
    return;
  }
  if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
    cells[r][c].value = "";
    highlightSelected(r, c);
    updateConflicts();
  }
  // number keys 1-9 via keyboard (beforeinput handles filtering, this advances after input)
}

// ── Number pad ────────────────────────────────────────────────────
function numpadInput(n) {
  if (!selectedCell) {
    // auto-focus the first empty cell
    outer: for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (!cells[r][c].value) {
          cells[r][c].focus();
          break outer;
        }
      }
    }
    if (!selectedCell) return;
  }
  selectedCell.value = n === 0 ? "" : String(n);
  highlightSelected(selectedR, selectedC);
  updateConflicts();
  // advance to next empty cell after numpad input
  if (n !== 0) advanceToNextEmpty(selectedR, selectedC);
}

function advanceToNextEmpty(fromR, fromC) {
  for (let i = fromR * 9 + fromC + 1; i < 81; i++) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    if (!cells[r][c].value) {
      cells[r][c].focus();
      return;
    }
  }
}

// ── Highlight ──────────────────────────────────────────────────────
function highlightSelected(r, c) {
  selectedCell = cells[r][c];
  selectedR = r;
  selectedC = c;

  for (let i = 0; i < 9; i++)
    for (let j = 0; j < 9; j++)
      cells[i][j].classList.remove("highlight", "selected", "match");

  const boxRow = Math.floor(r / 3) * 3;
  const boxCol = Math.floor(c / 3) * 3;
  const val = selectedCell.value;

  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const cell = cells[i][j];
      if (i === r || j === c ||
          (i >= boxRow && i < boxRow + 3 && j >= boxCol && j < boxCol + 3)) {
        cell.classList.add("highlight");
      }
      if (val && cell !== selectedCell && cell.value === val) {
        cell.classList.add("match");
      }
    }
  }
  selectedCell.classList.remove("highlight");
  selectedCell.classList.add("selected");
}

// ── Conflict detection ────────────────────────────────────────────
function updateConflicts() {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      cells[r][c].classList.remove("conflict");

  const checkGroup = (positions) => {
    const seen = {};
    for (const [r, c] of positions) {
      const v = cells[r][c].value;
      if (!v) continue;
      (seen[v] ||= []).push([r, c]);
    }
    for (const v in seen) {
      if (seen[v].length > 1)
        for (const [r, c] of seen[v])
          cells[r][c].classList.add("conflict");
    }
  };

  for (let r = 0; r < 9; r++)
    checkGroup([...Array(9)].map((_, c) => [r, c]));
  for (let c = 0; c < 9; c++)
    checkGroup([...Array(9)].map((_, r) => [r, c]));
  for (let br = 0; br < 3; br++)
    for (let bc = 0; bc < 3; bc++) {
      const pos = [];
      for (let i = 0; i < 9; i++)
        pos.push([br * 3 + Math.floor(i / 3), bc * 3 + (i % 3)]);
      checkGroup(pos);
    }
}

// ── Board state ───────────────────────────────────────────────────
function getBoardState() {
  return cells.map(row => row.map(cell => cell.value ? parseInt(cell.value) : 0));
}

// ── Actions ───────────────────────────────────────────────────────
function clearGrid() {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      cells[r][c].value = "";
      cells[r][c].classList.remove("conflict", "highlight", "selected", "match");
    }
  selectedCell = null;
  selectedR = -1;
  selectedC = -1;
  setStatus("");
}

function setStatus(msg, type) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.className = type || "";
}

async function savePuzzle() {
  if (document.querySelectorAll(".sudoku-cell.conflict").length > 0) {
    setStatus("Fix conflicts before saving.", "error");
    return;
  }

  const board = getBoardState();
  const clues = board.flat().filter(v => v !== 0).length;
  if (clues < 17) {
    setStatus(
      `Only ${clues} clue${clues === 1 ? "" : "s"} — minimum 17 needed for a valid sudoku.`,
      "error"
    );
    return;
  }

  const difficulty = document.querySelector('input[name="create-diff"]:checked').value;
  setStatus("Saving and solving…");

  let resp;
  try {
    resp = await fetch("/api/sudoku-create/puzzles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ difficulty, board }),
    });
  } catch {
    setStatus("Network error — is the server running?", "error");
    return;
  }

  const data = await resp.json();

  if (resp.status === 409) {
    setStatus(`Already exists as puzzle #${data.id}.`, "error");
    return;
  }
  if (!resp.ok) {
    setStatus(`Error: ${data.error || "unknown"}`, "error");
    return;
  }

  if (data.solved && !data.multiple_solutions) {
    setStatus(`Saved as #${data.id} · unique solution found ✓`);
  } else if (data.solved && data.multiple_solutions) {
    setStatus(`Saved as #${data.id} · warning: multiple solutions exist`, "warning");
  } else {
    setStatus(`Saved as #${data.id} · no solution found — check your clues`, "error");
  }
}

// ── Init ──────────────────────────────────────────────────────────
initBoard();
// focus top-left cell on load
cells[0][0].focus();
