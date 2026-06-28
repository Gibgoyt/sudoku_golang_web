// ── IndexedDB progress persistence ───────────────────────────────

let _idb = null;

function openIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sudokuProgress", 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore("progress", { keyPath: "puzzleId" });
    };
    req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveProgress(id, values, notes) {
  if (id === null) return;
  const db = await openIDB();
  const serializedNotes = notes.map(row => row.map(set => [...set]));
  return new Promise((resolve, reject) => {
    const tx = db.transaction("progress", "readwrite");
    tx.objectStore("progress").put({ puzzleId: id, values, notes: serializedNotes, savedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function loadProgress(id) {
  if (id === null) return null;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("progress", "readonly");
    const req = tx.objectStore("progress").get(id);
    req.onsuccess = (e) => {
      const result = e.target.result;
      if (!result) { resolve(null); return; }
      // backward compat: old format stored cells as a plain 2-D array
      if (Array.isArray(result.cells)) {
        resolve({ values: result.cells, notes: null });
      } else {
        resolve({ values: result.values, notes: result.notes });
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function clearProgress(id) {
  if (id === null) return;
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("progress", "readwrite");
    tx.objectStore("progress").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getAllProgressIds() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("progress", "readonly");
    const req = tx.objectStore("progress").getAllKeys();
    req.onsuccess = (e) => resolve(new Set(e.target.result));
    req.onerror = (e) => reject(e.target.error);
  });
}

// warm up IDB on page load
openIDB().catch(() => {});

// ── Board state ───────────────────────────────────────────────────

let currentPuzzleId = null;
let saveTimer = null;
let noteMode = false;
let noteState = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));

function resetNoteState() {
  noteState = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
}

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveProgress(currentPuzzleId, getBoardState(), noteState);
  }, 500);
}

// ── Cell helpers ──────────────────────────────────────────────────

function getCellInput(cellDiv) {
  return cellDiv.querySelector(".cell-input");
}

function getCellValue(cellDiv) {
  const input = getCellInput(cellDiv);
  return input ? input.value.trim() : "";
}

function getCellCoords(cellDiv) {
  const cells = document.getElementsByClassName("sudoku-cell");
  const idx = Array.from(cells).indexOf(cellDiv);
  return [Math.floor(idx / 9), idx % 9];
}

function renderCellNotes(cellDiv, row, col) {
  const notes = noteState[row][col];
  const overlay = cellDiv.querySelector(".cell-notes");
  const slots = overlay.querySelectorAll(".note-slot");
  for (let n = 1; n <= 9; n++) {
    slots[n - 1].textContent = notes.has(n) ? n : "";
  }
  const val = getCellValue(cellDiv);
  overlay.style.display = notes.size > 0 && !val ? "grid" : "none";
}

// ── Board rendering ───────────────────────────────────────────────

function renderBoard(board) {
  resetNoteState();
  const sudokuBoard = document.getElementById("sudoku-board");
  sudokuBoard.innerHTML = "";

  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const cellDiv = document.createElement("div");
      cellDiv.className = "sudoku-cell";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "cell-input";

      // 3×3 notes overlay
      const notesDiv = document.createElement("div");
      notesDiv.className = "cell-notes";
      notesDiv.style.display = "none";
      for (let n = 1; n <= 9; n++) {
        const slot = document.createElement("span");
        slot.className = "note-slot";
        slot.dataset.n = n;
        notesDiv.appendChild(slot);
      }

      if (board[i][j] !== 0) {
        input.value = board[i][j];
        input.readOnly = true;
        cellDiv.classList.add("prefilled");
      } else {
        cellDiv.classList.add("user-cell");
        input.maxLength = 1;

        input.addEventListener("beforeinput", (e) => {
          if (e.data === null) return; // allow delete / backspace
          if (!/^[1-9]$/.test(e.data)) { e.preventDefault(); return; }
          // in note mode, don't overwrite a cell that already has a value
          if (noteMode && input.value !== "") e.preventDefault();
        });

        input.addEventListener("input", () => {
          if (noteMode) {
            const typed = input.value.replace(/[^1-9]/g, "").slice(-1);
            input.value = "";
            if (typed) {
              const n = parseInt(typed);
              if (noteState[i][j].has(n)) noteState[i][j].delete(n);
              else noteState[i][j].add(n);
              renderCellNotes(cellDiv, i, j);
              updateNoteConflicts();
            }
            scheduleAutoSave();
          } else {
            const clean = input.value.replace(/[^1-9]/g, "").slice(0, 1);
            if (input.value !== clean) input.value = clean;
            if (clean) {
              noteState[i][j].clear();
              renderCellNotes(cellDiv, i, j);
            }
            highlightSelected(cellDiv);
            updateConflicts();
            updateNoteConflicts();
            updateSummary();
            scheduleAutoSave();
          }
        });
      }

      cellDiv.addEventListener("click", () => highlightSelected(cellDiv));

      cellDiv.appendChild(input);
      cellDiv.appendChild(notesDiv);
      sudokuBoard.appendChild(cellDiv);
    }
  }
  updateConflicts();
  updateNoteConflicts();
  updateSummary();
}

function restoreUserCells({ values, notes }) {
  const domCells = document.getElementsByClassName("sudoku-cell");
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const cellDiv = domCells[i * 9 + j];
      if (!cellDiv.classList.contains("user-cell")) continue;
      const input = getCellInput(cellDiv);
      if (values[i][j] !== 0) {
        input.value = String(values[i][j]);
      }
      if (notes && notes[i] && notes[i][j] && notes[i][j].length > 0) {
        noteState[i][j] = new Set(notes[i][j]);
        renderCellNotes(cellDiv, i, j);
      }
    }
  }
  updateConflicts();
  updateNoteConflicts();
  updateSummary();
}

function setStatus(msg, isError) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.className = isError ? "error" : "";
}

// ── API actions ────────────────────────────────────────────────────

async function generateNewPuzzle() {
  const response = await fetch("/api/generate");
  const data = await response.json();
  currentPuzzleId = "generated";
  renderBoard(data.board);
  setStatus("");
  const saved = await loadProgress("generated");
  if (saved) {
    restoreUserCells(saved);
    setStatus("Progress restored");
  }
}

async function checkSolution() {
  const userCells = document.getElementsByClassName("user-cell");
  for (const cell of userCells) {
    if (!getCellValue(cell)) {
      setStatus("Incomplete — fill all cells before checking.", true);
      return;
    }
  }

  const board = getBoardState();
  const response = await fetch("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ board }),
  });
  const result = await response.json();

  if (result.no_solution) {
    setStatus("No solution stored for this puzzle yet.", true);
    return;
  }

  if (result.correct) {
    setStatus("Correct! Puzzle solved!");
    await clearProgress(currentPuzzleId);
    return;
  }

  const cells = document.getElementsByClassName("sudoku-cell");
  if (result.wrong_cells && result.wrong_cells.length > 0) {
    for (const [r, c] of result.wrong_cells) {
      cells[r * 9 + c].classList.add("conflict");
    }
    const n = result.wrong_cells.length;
    setStatus(`${n} cell${n === 1 ? "" : "s"} are incorrect.`, true);
  } else {
    setStatus("Not finished yet — keep going!", true);
  }
}

function getBoardState() {
  const board = [];
  const cells = document.getElementsByClassName("sudoku-cell");
  for (let i = 0; i < 9; i++) {
    const row = [];
    for (let j = 0; j < 9; j++) {
      const value = getCellValue(cells[i * 9 + j]);
      row.push(value === "" ? 0 : parseInt(value));
    }
    board.push(row);
  }
  return board;
}

// ── Number summary ─────────────────────────────────────────────────

function updateSummary() {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  const cells = document.getElementsByClassName("sudoku-cell");
  for (const cell of cells) {
    const v = parseInt(getCellValue(cell));
    if (v >= 1 && v <= 9) counts[v]++;
  }
  const container = document.getElementById("number-summary");
  container.innerHTML = "";
  for (let n = 1; n <= 9; n++) {
    if (counts[n] >= 9) continue;
    const remaining = 9 - counts[n];
    const card = document.createElement("div");
    card.className = "num-card";
    card.innerHTML = `<span class="num-main">${n}</span><span class="num-count">${remaining}</span>`;
    card.addEventListener("click", () => highlightAllOfNumber(n));
    container.appendChild(card);
  }
}

function highlightAllOfNumber(n) {
  const cells = document.getElementsByClassName("sudoku-cell");
  for (const c of cells) {
    c.classList.remove("highlight", "selected", "match");
    c.querySelectorAll(".note-slot").forEach(s => s.classList.remove("note-match"));
  }
  const str = String(n);
  for (const c of cells) {
    if (getCellValue(c) === str) c.classList.add("match");
  }
}

// ── Conflict / highlight logic ─────────────────────────────────────

function highlightSelected(cellDiv) {
  const cells = document.getElementsByClassName("sudoku-cell");
  for (const c of cells) {
    c.classList.remove("highlight", "selected", "match");
    c.querySelectorAll(".note-slot").forEach(s => s.classList.remove("note-match"));
  }
  if (!cellDiv) return;
  const idx = Array.from(cells).indexOf(cellDiv);
  const row = Math.floor(idx / 9);
  const col = idx % 9;
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = 0; r < 9; r++) cells[r * 9 + col].classList.add("highlight");
  for (let c2 = 0; c2 < 9; c2++) cells[row * 9 + c2].classList.add("highlight");
  for (let r = boxRow; r < boxRow + 3; r++)
    for (let c2 = boxCol; c2 < boxCol + 3; c2++)
      cells[r * 9 + c2].classList.add("highlight");
  cellDiv.classList.add("selected");
  const val = getCellValue(cellDiv);
  if (val) {
    for (const c of cells) {
      if (c !== cellDiv && getCellValue(c) === val) c.classList.add("match");
    }
    // highlight note slots that contain the selected number
    for (const c of cells) {
      c.querySelectorAll(".note-slot").forEach(slot => {
        if (slot.textContent === val) slot.classList.add("note-match");
      });
    }
  }
}

function updateConflicts() {
  const cells = document.getElementsByClassName("sudoku-cell");
  for (const c of cells) c.classList.remove("conflict");

  const get = (r, c) => getCellValue(cells[r * 9 + c]);
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

function updateNoteConflicts() {
  const cells = document.getElementsByClassName("sudoku-cell");
  for (const c of cells) {
    c.querySelectorAll(".note-slot").forEach(s => s.classList.remove("note-conflict"));
  }
  for (let r = 0; r < 9; r++) {
    for (let col = 0; col < 9; col++) {
      const val = getCellValue(cells[r * 9 + col]);
      if (!val) continue;
      const n = parseInt(val);
      for (let c2 = 0; c2 < 9; c2++) {
        if (c2 !== col) markNoteSlotConflict(cells[r * 9 + c2], n);
      }
      for (let r2 = 0; r2 < 9; r2++) {
        if (r2 !== r) markNoteSlotConflict(cells[r2 * 9 + col], n);
      }
      const br = Math.floor(r / 3) * 3;
      const bc = Math.floor(col / 3) * 3;
      for (let i = br; i < br + 3; i++) {
        for (let j = bc; j < bc + 3; j++) {
          if (i !== r || j !== col) markNoteSlotConflict(cells[i * 9 + j], n);
        }
      }
    }
  }
}

function markNoteSlotConflict(cellDiv, n) {
  cellDiv.querySelectorAll(".note-slot").forEach(slot => {
    if (slot.textContent !== "" && parseInt(slot.textContent) === n) {
      slot.classList.add("note-conflict");
    }
  });
}

// ── Note mode toggle ───────────────────────────────────────────────

function eraseAllNotes() {
  resetNoteState();
  const cells = document.getElementsByClassName("sudoku-cell");
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const cellDiv = cells[i * 9 + j];
      if (cellDiv.classList.contains("user-cell")) {
        renderCellNotes(cellDiv, i, j);
      }
    }
  }
  updateNoteConflicts();
  scheduleAutoSave();
}

function toggleNoteMode() {
  noteMode = !noteMode;
  const btn = document.getElementById("note-mode-btn");
  btn.classList.toggle("note-mode-active", noteMode);
  btn.textContent = noteMode ? "Note Mode: ON" : "Note Mode";
}

// ── Modal ──────────────────────────────────────────────────────────

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

// ── Search ─────────────────────────────────────────────────────────

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

async function renderResults(results) {
  const container = document.getElementById("search-results");
  container.innerHTML = "";

  if (!results || results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "result-empty";
    empty.textContent = "No puzzles found.";
    container.appendChild(empty);
    return;
  }

  let progressIds = new Set();
  try { progressIds = await getAllProgressIds(); } catch (_) {}

  for (const p of results) {
    const row = document.createElement("div");
    row.className = "result-row";
    row.onclick = () => loadPuzzleById(p.id);

    const date = new Date(p.created_at).toLocaleDateString("en-US", {
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

    if (progressIds.has(p.id)) {
      const prog = document.createElement("span");
      prog.className = "progress-badge";
      prog.textContent = "▶ in progress";
      row.appendChild(prog);
    }

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
  currentPuzzleId = id;
  renderBoard(data.board);
  const hasSol = data.solution && data.solution.length > 0;
  setStatus(
    `Loaded #${data.id} · ${data.difficulty}${hasSol ? "" : " (no solution stored)"}`
  );
  closeModal();

  const saved = await loadProgress(id);
  if (saved) {
    restoreUserCells(saved);
    setStatus(`Progress restored for #${id} · ${data.difficulty}`);
  }
}
