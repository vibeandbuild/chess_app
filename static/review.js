const bootstrap = window.CHESS_REVIEW_BOOTSTRAP;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const SOUND_VOLUME = 0.9;

const PIECE_NAMES = {
  P: "White pawn",
  N: "White knight",
  B: "White bishop",
  R: "White rook",
  Q: "White queen",
  K: "White king",
  p: "Black pawn",
  n: "Black knight",
  b: "Black bishop",
  r: "Black rook",
  q: "Black queen",
  k: "Black king",
};

const refs = {
  board: document.querySelector("#review-board"),
  positionTitle: document.querySelector("#review-position-title"),
  sideToMove: document.querySelector("#review-side-to-move"),
  historyLabel: document.querySelector("#review-history-label"),
  moveList: document.querySelector("#review-move-list"),
  status: document.querySelector("#review-status"),
  analysisStatus: document.querySelector("#review-analysis-status"),
  error: document.querySelector("#review-error"),
  topMoves: document.querySelector("#review-top-moves"),
  evalLabel: document.querySelector("#review-eval-label"),
  start: document.querySelector("#review-start"),
  back: document.querySelector("#review-back"),
  forward: document.querySelector("#review-forward"),
  end: document.querySelector("#review-end"),
  flip: document.querySelector("#review-flip"),
};

const soundBank = Object.fromEntries(
  Object.entries(bootstrap.soundFiles || {}).map(([key, src]) => [key, { src }]),
);

const state = {
  snapshots: Array.isArray(bootstrap.reviewGame?.snapshots) ? bootstrap.reviewGame.snapshots : [],
  moves: Array.isArray(bootstrap.reviewGame?.moves) ? bootstrap.reviewGame.moves : [],
  displayIndex: 0,
  orientation: "white",
  analysisCache: new Map(),
  analysisRequestSerial: 0,
  analysisFen: null,
};

function currentSnapshot() {
  return state.snapshots[state.displayIndex];
}

function parseFenBoard(fen) {
  const [placement] = fen.split(" ");
  const board = new Map();
  let rank = 8;
  let fileIndex = 0;

  for (const symbol of placement) {
    if (symbol === "/") {
      rank -= 1;
      fileIndex = 0;
      continue;
    }

    if (/\d/.test(symbol)) {
      fileIndex += Number(symbol);
      continue;
    }

    board.set(`${FILES[fileIndex]}${rank}`, symbol);
    fileIndex += 1;
  }

  return board;
}

function playSound(key) {
  const source = soundBank[key];
  if (!source) {
    return;
  }

  const audio = new Audio(source.src);
  audio.volume = SOUND_VOLUME;
  void audio.play().catch(() => {});
}

function getVisibleFiles() {
  return state.orientation === "white" ? FILES : [...FILES].reverse();
}

function getVisibleRanks() {
  return state.orientation === "white"
    ? [8, 7, 6, 5, 4, 3, 2, 1]
    : [1, 2, 3, 4, 5, 6, 7, 8];
}

function isLightSquare(file, rank) {
  return (FILES.indexOf(file) + rank) % 2 === 0;
}

function pieceImage(piece) {
  return bootstrap.pieceImages[piece];
}

function pieceName(piece) {
  return PIECE_NAMES[piece] || "piece";
}

function getLastMoveSquares(snapshot) {
  if (!snapshot?.last_move) {
    return new Set();
  }

  return new Set([snapshot.last_move.slice(0, 2), snapshot.last_move.slice(2, 4)]);
}

function getMoveSquares(moveUci) {
  return {
    from: moveUci.slice(0, 2),
    to: moveUci.slice(2, 4),
    promotion: moveUci.length > 4 ? moveUci[4] : null,
  };
}

function isCastleMove(boardState, moveUci) {
  if (!boardState || !moveUci) {
    return false;
  }

  const boardMap = parseFenBoard(boardState.fen);
  const { from, to } = getMoveSquares(moveUci);
  const piece = boardMap.get(from);
  return Boolean(
    piece &&
    (piece === "K" || piece === "k") &&
    Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2
  );
}

function isCaptureMove(boardState, moveUci) {
  if (!boardState || !moveUci) {
    return false;
  }

  const boardMap = parseFenBoard(boardState.fen);
  const { from, to } = getMoveSquares(moveUci);
  const piece = boardMap.get(from);
  if (!piece) {
    return false;
  }

  if (boardMap.has(to)) {
    return true;
  }

  if ((piece === "P" || piece === "p") && from[0] !== to[0]) {
    return true;
  }

  return false;
}

function soundKeyForMove({ beforeBoard, afterBoard, moveUci, actor }) {
  if (!beforeBoard || !afterBoard || !moveUci) {
    return null;
  }

  if (afterBoard.game_over) {
    return "gameEnd";
  }

  if (getMoveSquares(moveUci).promotion) {
    return "promote";
  }

  if (isCastleMove(beforeBoard, moveUci)) {
    return "castle";
  }

  if (afterBoard.in_check) {
    return "moveCheck";
  }

  if (isCaptureMove(beforeBoard, moveUci)) {
    return "capture";
  }

  return actor === "engine" ? "moveOpponent" : "movePiece";
}

function actorForMove(move) {
  if (!move) {
    return "player";
  }

  return move.color === bootstrap.savedGame.player_color ? "player" : "engine";
}

function evaluationToWhiteShare(evaluation) {
  if (!evaluation || evaluation.type == null) {
    return 50;
  }

  if (evaluation.type === "mate" && Number.isFinite(evaluation.value)) {
    return evaluation.value > 0 ? 100 : 0;
  }

  const centipawns = Number(evaluation.centipawns);
  if (!Number.isFinite(centipawns)) {
    return 50;
  }

  const capped = Math.max(-1000, Math.min(1000, centipawns));
  return 50 + (capped / 1000) * 50;
}

function renderBoard() {
  const snapshot = currentSnapshot();
  const boardMap = parseFenBoard(snapshot.fen);
  const files = getVisibleFiles();
  const ranks = getVisibleRanks();
  const lastMoveSquares = getLastMoveSquares(snapshot);

  refs.board.innerHTML = "";

  ranks.forEach((rank, rankIndex) => {
    files.forEach((file, fileIndex) => {
      const square = `${file}${rank}`;
      const piece = boardMap.get(square);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "board-square";
      button.disabled = true;
      button.dataset.square = square;
      button.setAttribute("aria-label", `${square}, ${piece ? pieceName(piece) : "empty"}`);
      button.classList.add(isLightSquare(file, rank) ? "board-square--light" : "board-square--dark");

      if (lastMoveSquares.has(square)) {
        button.classList.add("board-square--last");
      }

      if (snapshot.check_square === square) {
        button.classList.add("board-square--check");
      }

      if (rankIndex === ranks.length - 1) {
        const fileLabel = document.createElement("span");
        fileLabel.className = "coord coord--file";
        fileLabel.textContent = file;
        button.append(fileLabel);
      }

      if (fileIndex === 0) {
        const rankLabel = document.createElement("span");
        rankLabel.className = "coord coord--rank";
        rankLabel.textContent = String(rank);
        button.append(rankLabel);
      }

      if (piece) {
        const image = document.createElement("img");
        image.className = "piece";
        image.alt = pieceName(piece);
        image.src = pieceImage(piece);
        image.draggable = false;
        button.append(image);
      }

      refs.board.append(button);
    });
  });
}

function historyLabelText() {
  if (state.displayIndex === 0) {
    return "Start";
  }

  return `Ply ${state.displayIndex}/${state.snapshots.length - 1}`;
}

function positionTitleText() {
  if (state.displayIndex === 0) {
    return "Start position";
  }

  const move = state.moves[state.displayIndex - 1];
  if (!move) {
    return "Position";
  }

  return state.displayIndex === state.snapshots.length - 1
    ? `Final position after ${move.san}`
    : `After ${move.san}`;
}

function renderMoveList() {
  refs.moveList.innerHTML = "";

  if (!state.moves.length) {
    const empty = document.createElement("p");
    empty.className = "move-list__empty";
    empty.textContent = "No moves saved for this game.";
    refs.moveList.append(empty);
    return;
  }

  const turns = [];
  for (const move of state.moves) {
    let turn = turns[turns.length - 1];
    if (!turn || turn.turn !== move.turn) {
      turn = { turn: move.turn, white: null, black: null };
      turns.push(turn);
    }
    turn[move.color] = move;
  }

  turns.forEach((turn) => {
    const row = document.createElement("div");
    row.className = "move-row";

    const index = document.createElement("span");
    index.className = "move-index";
    index.textContent = `${turn.turn}.`;
    row.append(index);

    ["white", "black"].forEach((color) => {
      const move = turn[color];
      if (!move) {
        const placeholder = document.createElement("span");
        placeholder.className = "move-cell move-cell--placeholder";
        placeholder.textContent = "-";
        row.append(placeholder);
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "move-cell move-cell--button";
      button.dataset.plyIndex = String(move.ply_index);
      button.textContent = move.san;
      button.setAttribute("aria-pressed", state.displayIndex === move.ply_index ? "true" : "false");
      if (state.displayIndex === move.ply_index) {
        button.classList.add("move-cell--active");
      }
      row.append(button);
    });

    refs.moveList.append(row);
  });
}

function renderAnalysis(analysis, fen) {
  if (fen !== currentSnapshot().fen) {
    return;
  }

  state.analysisFen = fen;
  refs.error.textContent = "";
  const evaluation = analysis?.evaluation_details || { label: "n/a", type: null, centipawns: null };
  refs.evalLabel.textContent = evaluation.label ?? "n/a";
  document.documentElement.style.setProperty("--white-share", `${evaluationToWhiteShare(evaluation)}%`);

  refs.topMoves.innerHTML = "";
  if (!analysis?.top_moves?.length) {
    const empty = document.createElement("p");
    empty.className = "move-list__empty";
    empty.textContent = currentSnapshot().game_over
      ? "Engine review stops at the final result."
      : "No engine lines available for this position.";
    refs.topMoves.append(empty);
    return;
  }

  analysis.top_moves.forEach((move, index) => {
    const row = document.createElement("article");
    row.className = "engine-line";

    const score = document.createElement("span");
    score.className = "engine-line__score";
    score.textContent = move.evaluation_details?.label || "n/a";

    const text = document.createElement("div");
    text.className = "engine-line__text";
    text.textContent = String(move.line || move.san || "").trim();

    row.append(score, text);
    refs.topMoves.append(row);
  });
}

async function loadAnalysis() {
  const snapshot = currentSnapshot();
  refs.status.textContent = snapshot.status;

  if (snapshot.game_over) {
    refs.analysisStatus.textContent = "Final position.";
    renderAnalysis({
      evaluation_details: { label: "n/a", type: null, centipawns: null },
      top_moves: [],
    }, snapshot.fen);
    return;
  }

  const cached = state.analysisCache.get(snapshot.fen);
  if (cached) {
    refs.analysisStatus.textContent = `Stockfish review at skill ${bootstrap.savedGame.skill_level} / depth ${bootstrap.savedGame.depth}.`;
    renderAnalysis(cached, snapshot.fen);
    return;
  }

  const requestSerial = state.analysisRequestSerial + 1;
  state.analysisRequestSerial = requestSerial;
  refs.analysisStatus.textContent = "Loading engine review...";
  refs.error.textContent = "";

  try {
    const response = await fetch("/api/review-analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fen: snapshot.fen,
        skill_level: bootstrap.savedGame.skill_level,
        depth: bootstrap.savedGame.depth,
        lines: 3,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not load analysis");
    }

    if (requestSerial !== state.analysisRequestSerial) {
      return;
    }

    state.analysisCache.set(snapshot.fen, data);
    refs.analysisStatus.textContent = `Stockfish review at skill ${bootstrap.savedGame.skill_level} / depth ${bootstrap.savedGame.depth}.`;
    renderAnalysis(data, snapshot.fen);
  } catch (error) {
    if (requestSerial !== state.analysisRequestSerial) {
      return;
    }

    refs.analysisStatus.textContent = "Analysis unavailable for this position.";
    refs.error.textContent = error instanceof Error ? error.message : "Could not load analysis";
    renderAnalysis({
      evaluation_details: { label: "n/a", type: null, centipawns: null },
      top_moves: [],
    }, snapshot.fen);
  }
}

function renderMeta() {
  const snapshot = currentSnapshot();
  refs.positionTitle.textContent = positionTitleText();
  refs.sideToMove.textContent = snapshot.game_over
    ? (snapshot.result || "Finished")
    : `${snapshot.turn === "white" ? "White" : "Black"} to move`;
  refs.historyLabel.textContent = historyLabelText();
  refs.start.disabled = state.displayIndex === 0;
  refs.back.disabled = state.displayIndex === 0;
  refs.forward.disabled = state.displayIndex >= state.snapshots.length - 1;
  refs.end.disabled = state.displayIndex >= state.snapshots.length - 1;
}

function render() {
  renderBoard();
  renderMoveList();
  renderMeta();
  void loadAnalysis();
}

function goToIndex(index) {
  const nextIndex = Math.max(0, Math.min(index, state.snapshots.length - 1));
  if (nextIndex === state.displayIndex) {
    return;
  }

  const movingForward = nextIndex > state.displayIndex;
  const move = movingForward ? state.moves[nextIndex - 1] : null;
  const soundKey = movingForward
    ? soundKeyForMove({
        beforeBoard: state.snapshots[nextIndex - 1],
        afterBoard: state.snapshots[nextIndex],
        moveUci: move?.uci,
        actor: actorForMove(move),
      })
    : null;

  state.displayIndex = nextIndex;
  render();

  if (soundKey) {
    playSound(soundKey);
  }
}

refs.moveList.addEventListener("click", (event) => {
  const button = event.target.closest(".move-cell--button");
  if (!button) {
    return;
  }

  goToIndex(Number(button.dataset.plyIndex));
});

refs.start.addEventListener("click", () => goToIndex(0));
refs.back.addEventListener("click", () => goToIndex(state.displayIndex - 1));
refs.forward.addEventListener("click", () => goToIndex(state.displayIndex + 1));
refs.end.addEventListener("click", () => goToIndex(state.snapshots.length - 1));
refs.flip.addEventListener("click", () => {
  state.orientation = state.orientation === "white" ? "black" : "white";
  renderBoard();
});

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }

  if (event.target instanceof HTMLElement) {
    const tag = event.target.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return;
    }
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    goToIndex(state.displayIndex - 1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    goToIndex(state.displayIndex + 1);
  }
});

render();
