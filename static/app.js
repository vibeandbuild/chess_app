const bootstrap = window.CHESS_BOOTSTRAP;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const SVG_NS = "http://www.w3.org/2000/svg";
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
const INITIAL_COUNTS = {
  P: 8,
  N: 2,
  B: 2,
  R: 2,
  Q: 1,
  K: 1,
  p: 8,
  n: 2,
  b: 2,
  r: 2,
  q: 1,
  k: 1,
};
const PIECE_ORDER = {
  black: ["q", "r", "b", "n", "p"],
  white: ["Q", "R", "B", "N", "P"],
};
const PROMOTION_ORDER = ["q", "r", "b", "n"];
const SOUND_VOLUME = 0.9;
const MOVE_ANIMATION_MS = 420;

const refs = {
  board: document.querySelector("#board"),
  boardShell: document.querySelector("#board-shell"),
  arrowLayer: document.querySelector("#arrow-layer"),
  statusText: document.querySelector("#status-text"),
  turnIndicator: document.querySelector("#turn-indicator"),
  engineMove: document.querySelector("#engine-move"),
  evaluationText: document.querySelector("#evaluation-text"),
  evalMeterLabel: document.querySelector("#eval-meter-label"),
  fenOutput: document.querySelector("#fen-output"),
  error: document.querySelector("#error"),
  downloadPgn: document.querySelector("#download-pgn"),
  moveList: document.querySelector("#move-list"),
  skillLevel: document.querySelector("#skill_level"),
  depth: document.querySelector("#depth"),
  newGame: document.querySelector("#new-game"),
  flipBoard: document.querySelector("#flip-board"),
  playWhite: document.querySelector("#play-white"),
  playBlack: document.querySelector("#play-black"),
  historyBack: document.querySelector("#history-back"),
  historyForward: document.querySelector("#history-forward"),
  historyLabel: document.querySelector("#history-label"),
  capturedBlack: document.querySelector("#captured-black"),
  capturedWhite: document.querySelector("#captured-white"),
  savedGames: document.querySelector("#saved-games"),
  savedGamesCount: document.querySelector("#saved-games-count"),
  promotionDialog: document.querySelector("#promotion-dialog"),
  promotionOptions: document.querySelector("#promotion-options"),
  cancelPromotion: document.querySelector("#cancel-promotion"),
  playerCardLabel: document.querySelector("#player-card-label"),
  engineCardLabel: document.querySelector("#engine-card-label"),
  playerResultCrown: document.querySelector("#player-result-crown"),
  engineResultCrown: document.querySelector("#engine-result-crown"),
  resultOverlay: document.querySelector("#result-overlay"),
  resultOverlayTitle: document.querySelector("#result-overlay-title"),
};

const state = {
  liveTimeline: [cloneBoardState(bootstrap.initialState)],
  displayIndex: 0,
  selectedSquare: null,
  orientation: "white",
  playerColor: "white",
  busy: false,
  pendingPromotion: null,
  moveHistory: [],
  plyHistory: [],
  evaluation: equalEvaluation(),
  lastEngineMove: "-",
  error: "",
  requestSerial: 0,
  dragSource: null,
  pendingDrag: null,
  dragPreview: null,
  suppressNextClick: false,
  transitioning: false,
  premove: null,
  premoveLegalMoves: [],
  premoveLegalMovesFen: null,
  premoveRequestSerial: 0,
  markedSquares: [],
  arrows: [],
  arrowDraft: null,
  savedGames: Array.isArray(bootstrap.savedGames) ? [...bootstrap.savedGames] : [],
  savedGameId: null,
  gameSessionId: generateSessionId(),
};

const soundBank = Object.fromEntries(
  Object.entries(bootstrap.soundFiles || {}).map(([key, src]) => {
    const audio = new Audio(src);
    audio.preload = "auto";
    return [key, audio];
  }),
);

function cloneBoardState(boardState) {
  return JSON.parse(JSON.stringify(boardState));
}

function equalEvaluation() {
  return {
    type: "cp",
    value: 0,
    centipawns: 0,
    label: "0.00",
  };
}

function emptyEvaluation() {
  return {
    type: null,
    value: null,
    centipawns: null,
    label: "n/a",
  };
}

function generateSessionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
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

function sanitizeInput(input, min, max, fallback) {
  const value = clamp(Number(input.value), min, max, fallback);
  input.value = String(value);
  return value;
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

    const square = `${FILES[fileIndex]}${rank}`;
    board.set(square, symbol);
    fileIndex += 1;
  }

  return board;
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
  return Boolean(piece && (piece === "K" || piece === "k") && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2);
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

function canQueuePremove() {
  const board = getDisplayBoard();
  return (
    isLatestView() &&
    !state.transitioning &&
    !state.pendingPromotion &&
    !board.game_over &&
    board.turn !== state.playerColor
  );
}

function canInteractWithPieces() {
  return canMovePieces() || canQueuePremove();
}

function clearPremoveLegalMoves() {
  state.premoveLegalMoves = [];
  state.premoveLegalMovesFen = null;
}

function getCurrentPremoveLegalMoves() {
  const board = getDisplayBoard();
  if (!canQueuePremove() || state.premoveLegalMovesFen !== board.fen) {
    return [];
  }

  return state.premoveLegalMoves;
}

function getPremoveSquares() {
  if (!state.premove || !isLatestView()) {
    return new Map();
  }

  return new Map([
    [state.premove.from, "source"],
    [state.premove.to, "target"],
  ]);
}

function isPremoveSourceSquare(square) {
  return Boolean(state.premove && isLatestView() && square === state.premove.from);
}

function getPremovePreviewPiece(square, boardMap) {
  if (!state.premove || !isLatestView() || square !== state.premove.to) {
    return null;
  }

  return boardMap.get(state.premove.from) || null;
}

function buildPremoveUci(from, to, boardState = getDisplayBoard()) {
  if (!from || !to || from === to) {
    return null;
  }

  const boardMap = parseFenBoard(boardState.fen);
  const piece = boardMap.get(from);
  if (!piece || !isPlayerPiece(piece)) {
    return null;
  }

  let promotion = "";
  if ((piece === "P" && to[1] === "8") || (piece === "p" && to[1] === "1")) {
    promotion = "q";
  }

  return `${from}${to}${promotion}`;
}

function clearPremove() {
  state.premove = null;
}

async function preloadPremoveLegalMoves(fen = getLiveBoard().fen) {
  if (!fen) {
    clearPremoveLegalMoves();
    return [];
  }

  if (state.premoveLegalMovesFen === fen) {
    return state.premoveLegalMoves;
  }

  const requestId = state.premoveRequestSerial + 1;
  state.premoveRequestSerial = requestId;

  try {
    const data = await fetchJson("/api/premove-moves", {
      fen,
      player_color: state.playerColor,
    });

    if (requestId !== state.premoveRequestSerial || getLiveBoard().fen !== fen) {
      return [];
    }

    state.premoveLegalMoves = Array.isArray(data.legal_moves) ? data.legal_moves : [];
    state.premoveLegalMovesFen = fen;

    if (canQueuePremove()) {
      render();
    }

    return state.premoveLegalMoves;
  } catch {
    if (requestId === state.premoveRequestSerial) {
      clearPremoveLegalMoves();
      if (canQueuePremove()) {
        render();
      }
    }
    return [];
  }
}

async function ensurePremoveLegalMoves() {
  const fen = getLiveBoard().fen;
  if (state.premoveLegalMovesFen === fen) {
    return state.premoveLegalMoves;
  }

  return preloadPremoveLegalMoves(fen);
}

function setPremove(from, to, options = {}) {
  const uci = buildPremoveUci(from, to);
  state.selectedSquare = null;

  if (!uci) {
    render();
    return;
  }

  if (state.premove?.uci === uci) {
    clearPremove();
    render();
    return;
  }

  state.error = "";
  state.premove = {
    from,
    to,
    uci,
    inputMethod: options.inputMethod || "click",
  };
  render();
  playSound("premove");
}

function findLegalPremove(boardState) {
  if (!state.premove || !boardState?.legal_moves) {
    return null;
  }

  return boardState.legal_moves.find((moveUci) => moveUci === state.premove.uci) || null;
}

function actorForBoardTurn(boardState) {
  if (!boardState) {
    return "player";
  }

  return boardState.turn === state.playerColor ? "player" : "engine";
}

function getTimelineTransition(fromIndex, toIndex) {
  if (Math.abs(toIndex - fromIndex) !== 1) {
    return null;
  }

  const stepIndex = Math.min(fromIndex, toIndex);
  const beforeBoard = state.liveTimeline[stepIndex];
  const afterBoard = state.liveTimeline[stepIndex + 1];
  const moveUci = state.plyHistory[stepIndex];
  if (!beforeBoard || !afterBoard || !moveUci) {
    return null;
  }

  return {
    beforeBoard,
    afterBoard,
    moveUci,
    reverse: toIndex < fromIndex,
    actor: actorForBoardTurn(beforeBoard),
  };
}

function buildMoveIndex(legalMoves) {
  const moveIndex = new Map();

  legalMoves.forEach((uci) => {
    const move = {
      uci,
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : null,
    };

    if (!moveIndex.has(move.from)) {
      moveIndex.set(move.from, []);
    }

    moveIndex.get(move.from).push(move);
  });

  return moveIndex;
}

function getLiveBoard() {
  return state.liveTimeline[state.liveTimeline.length - 1];
}

function getDisplayBoard() {
  return state.liveTimeline[state.displayIndex];
}

function isLatestView() {
  return state.displayIndex === state.liveTimeline.length - 1;
}

function engineColor() {
  return state.playerColor === "white" ? "black" : "white";
}

function pieceColor(piece) {
  return piece === piece.toUpperCase() ? "white" : "black";
}

function isPlayerPiece(piece) {
  return pieceColor(piece) === state.playerColor;
}

function canMovePieces() {
  const board = getDisplayBoard();
  return (
    isLatestView() &&
    !state.busy &&
    !state.transitioning &&
    !state.pendingPromotion &&
    !board.game_over &&
    board.turn === state.playerColor
  );
}

function isLightSquare(file, rank) {
  return (FILES.indexOf(file) + rank) % 2 === 0;
}

function pieceName(piece) {
  return PIECE_NAMES[piece] || "piece";
}

function pieceImage(piece) {
  return bootstrap.pieceImages[piece];
}

function getVisibleFiles() {
  return state.orientation === "white" ? FILES : [...FILES].reverse();
}

function getVisibleRanks() {
  return state.orientation === "white"
    ? [8, 7, 6, 5, 4, 3, 2, 1]
    : [1, 2, 3, 4, 5, 6, 7, 8];
}

function getLastMoveSquares() {
  const board = getDisplayBoard();
  if (!board.last_move) {
    return new Set();
  }

  return new Set([
    board.last_move.slice(0, 2),
    board.last_move.slice(2, 4),
  ]);
}

function getSelectedTargets(moveIndex) {
  const targets = new Map();

  if (!state.selectedSquare) {
    return targets;
  }

  const moves = moveIndex.get(state.selectedSquare) || [];
  moves.forEach((move) => {
    if (!targets.has(move.to)) {
      targets.set(move.to, []);
    }

    targets.get(move.to).push(move);
  });

  return targets;
}

function evaluationToWhiteShare(evaluation) {
  if (!evaluation || evaluation.centipawns == null) {
    return 50;
  }

  if (evaluation.type === "mate") {
    return evaluation.value > 0 ? 100 : 0;
  }

  const normalized = Math.tanh(evaluation.centipawns / 400);
  return Math.round((normalized + 1) * 50);
}

function getPieceCounts(boardMap) {
  const counts = { ...INITIAL_COUNTS };
  Object.keys(counts).forEach((piece) => {
    counts[piece] = 0;
  });

  boardMap.forEach((piece) => {
    counts[piece] += 1;
  });

  return counts;
}

function getCapturedPieces(color, counts) {
  const pieces = [];

  PIECE_ORDER[color].forEach((piece) => {
    const missing = INITIAL_COUNTS[piece] - (counts[piece] || 0);
    for (let index = 0; index < missing; index += 1) {
      pieces.push(piece);
    }
  });

  return pieces;
}

function renderCapturedRow(container, pieces) {
  container.innerHTML = "";

  if (!pieces.length) {
    const empty = document.createElement("span");
    empty.className = "captured-row__empty";
    empty.textContent = "None";
    container.append(empty);
    return;
  }

  pieces.forEach((piece) => {
    const image = document.createElement("img");
    image.src = pieceImage(piece);
    image.alt = pieceName(piece);
    container.append(image);
  });
}

function renderCapturedPieces() {
  const boardMap = parseFenBoard(getDisplayBoard().fen);
  const counts = getPieceCounts(boardMap);
  renderCapturedRow(refs.capturedBlack, getCapturedPieces("black", counts));
  renderCapturedRow(refs.capturedWhite, getCapturedPieces("white", counts));
}
function getSquareFromTarget(target) {
  return target instanceof Element ? target.closest(".board-square")?.dataset.square || null : null;
}

function getSquareFromPoint(clientX, clientY) {
  return getSquareFromTarget(document.elementFromPoint(clientX, clientY));
}

function clearPieceDrag() {
  if (state.dragPreview) {
    state.dragPreview.ghost.remove();
    if (state.dragPreview.sourceImage.isConnected) {
      state.dragPreview.sourceImage.style.visibility = "";
    }
  }

  state.pendingDrag = null;
  state.dragPreview = null;
  state.dragSource = null;
}

function positionPieceDrag(clientX, clientY) {
  if (!state.dragPreview) {
    return;
  }

  const boardShellRect = refs.boardShell.getBoundingClientRect();
  state.dragPreview.ghost.style.left = `${clientX - boardShellRect.left - state.dragPreview.offsetX}px`;
  state.dragPreview.ghost.style.top = `${clientY - boardShellRect.top - state.dragPreview.offsetY}px`;
}

function activatePieceDrag(square, clientX, clientY) {
  clearAnnotations();
  state.selectedSquare = square;
  state.error = "";
  render();

  const sourceImage = refs.board.querySelector(`.piece[data-square="${square}"]`);
  if (!sourceImage) {
    clearPieceDrag();
    return;
  }

  const sourceRect = sourceImage.getBoundingClientRect();
  const ghost = sourceImage.cloneNode(true);
  ghost.classList.add("piece-ghost");
  ghost.classList.add("piece-ghost--drag");
  ghost.style.width = `${sourceRect.width}px`;
  ghost.style.height = `${sourceRect.height}px`;
  refs.boardShell.append(ghost);

  sourceImage.style.visibility = "hidden";
  state.dragSource = square;
  state.dragPreview = {
    ghost,
    sourceImage,
    offsetX: clientX - sourceRect.left,
    offsetY: clientY - sourceRect.top,
  };
  positionPieceDrag(clientX, clientY);
}

function clearAnnotations() {
  const changed = Boolean(state.arrows.length || state.arrowDraft || state.markedSquares.length);
  state.arrows = [];
  state.arrowDraft = null;
  state.markedSquares = [];
  return changed;
}

function createSvgElement(tagName) {
  return document.createElementNS(SVG_NS, tagName);
}

function getSquareCenter(square) {
  const file = square[0];
  const rank = Number(square[1]);
  const fileIndex = FILES.indexOf(file);
  const displayFileIndex = state.orientation === "white" ? fileIndex : 7 - fileIndex;
  const displayRankIndex = state.orientation === "white" ? 8 - rank : rank - 1;

  return {
    x: displayFileIndex * 100 + 50,
    y: displayRankIndex * 100 + 50,
  };
}

function buildArrowElement(fromSquare, toSquare, isDraft) {
  if (!fromSquare || !toSquare || fromSquare === toSquare) {
    return null;
  }

  const start = getSquareCenter(fromSquare);
  const end = getSquareCenter(toSquare);
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);

  if (!length) {
    return null;
  }

  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const startOffset = 10;
  const endOffset = 18;
  const x1 = start.x + unitX * startOffset;
  const y1 = start.y + unitY * startOffset;
  const x2 = end.x - unitX * endOffset;
  const y2 = end.y - unitY * endOffset;

  const group = createSvgElement("g");
  group.setAttribute("class", isDraft ? "board-arrow board-arrow--draft" : "board-arrow");

  const tail = createSvgElement("circle");
  tail.setAttribute("class", "board-arrow__tail");
  tail.setAttribute("cx", String(start.x));
  tail.setAttribute("cy", String(start.y));
  tail.setAttribute("r", "6");

  const line = createSvgElement("line");
  line.setAttribute("class", "board-arrow__line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("marker-end", isDraft ? "url(#arrow-head-draft)" : "url(#arrow-head)");

  group.append(tail, line);
  return group;
}

function renderArrows() {
  refs.arrowLayer.innerHTML = "";

  state.arrows.forEach((arrow) => {
    const element = buildArrowElement(arrow.from, arrow.to, false);
    if (element) {
      refs.arrowLayer.append(element);
    }
  });

  if (state.arrowDraft) {
    const draft = buildArrowElement(state.arrowDraft.from, state.arrowDraft.to, true);
    if (draft) {
      refs.arrowLayer.append(draft);
    }
  }
}

function toggleArrow(from, to) {
  const existingIndex = state.arrows.findIndex(
    (arrow) => arrow.from === from && arrow.to === to,
  );

  if (existingIndex >= 0) {
    state.arrows.splice(existingIndex, 1);
    return;
  }

  state.arrows.push({ from, to });
}

function isMarkedSquare(square) {
  return state.markedSquares.includes(square);
}

function toggleMarkedSquare(square) {
  if (!square) {
    return;
  }

  if (isMarkedSquare(square)) {
    state.markedSquares = state.markedSquares.filter((markedSquare) => markedSquare !== square);
    return;
  }

  state.markedSquares.push(square);
}

function beginArrow(square) {
  state.arrowDraft = { from: square, to: square };
  renderArrows();
}

function updateArrowDraft(square) {
  if (!state.arrowDraft || state.arrowDraft.to === square) {
    return;
  }

  state.arrowDraft.to = square;
  renderArrows();
}

function finishArrow(square) {
  if (!state.arrowDraft) {
    return;
  }

  const fromSquare = state.arrowDraft.from;
  const toSquare = square || state.arrowDraft.to;
  state.arrowDraft = null;

  if (fromSquare && toSquare && fromSquare !== toSquare) {
    toggleArrow(fromSquare, toSquare);
  } else if (fromSquare && toSquare && fromSquare === toSquare) {
    toggleMarkedSquare(fromSquare);
  }

  render();
}

function cancelArrowDraft() {
  if (!state.arrowDraft) {
    return;
  }

  state.arrowDraft = null;
  renderArrows();
}

function getCastleRookPlan(piece, moveUci, reverse = false) {
  const castles = {
    e1g1: { from: "h1", to: "f1", piece: "R" },
    e1c1: { from: "a1", to: "d1", piece: "R" },
    e8g8: { from: "h8", to: "f8", piece: "r" },
    e8c8: { from: "a8", to: "d8", piece: "r" },
  };

  if ((piece === "K" || piece === "k") && castles[moveUci]) {
    const rookPlan = castles[moveUci];
    if (!reverse) {
      return rookPlan;
    }

    return {
      from: rookPlan.to,
      to: rookPlan.from,
      piece: rookPlan.piece,
    };
  }

  return null;
}

function getAnimationPlans(moveUci, boardState = getDisplayBoard(), reverse = false) {
  if (!moveUci || !boardState) {
    return [];
  }

  const boardMap = parseFenBoard(boardState.fen);
  const { from: moveFrom, to: moveTo } = getMoveSquares(moveUci);
  const from = reverse ? moveTo : moveFrom;
  const to = reverse ? moveFrom : moveTo;
  const piece = boardMap.get(from);
  if (!piece) {
    return [];
  }

  const plans = [{ from, to, piece }];
  const castleRook = getCastleRookPlan(piece, moveUci, reverse);
  if (castleRook) {
    plans.push(castleRook);
  }

  return plans;
}

async function animateMoveTransition(moveUci, options = {}) {
  const { boardState = getDisplayBoard(), reverse = false } = options;
  const plans = getAnimationPlans(moveUci, boardState, reverse);
  if (!plans.length) {
    return;
  }

  const boardShellRect = refs.boardShell.getBoundingClientRect();
  const activeGhosts = [];

  plans.forEach((plan) => {
    const sourceImage = refs.board.querySelector(`.piece[data-square="${plan.from}"]`);
    const targetSquare = refs.board.querySelector(`.board-square[data-square="${plan.to}"]`);

    if (!sourceImage || !targetSquare) {
      return;
    }

    const sourceRect = sourceImage.getBoundingClientRect();
    const targetRect = targetSquare.getBoundingClientRect();
    const ghost = sourceImage.cloneNode(true);
    ghost.classList.add("piece-ghost");
    ghost.classList.add("piece-ghost--move");
    ghost.style.visibility = "visible";
    ghost.style.left = `${sourceRect.left - boardShellRect.left}px`;
    ghost.style.top = `${sourceRect.top - boardShellRect.top}px`;
    ghost.style.width = `${sourceRect.width}px`;
    ghost.style.height = `${sourceRect.height}px`;
    ghost.style.transition = `transform ${MOVE_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;

    refs.boardShell.append(ghost);
    sourceImage.style.visibility = "hidden";
    activeGhosts.push({
      ghost,
      sourceImage,
      deltaX: targetRect.left - sourceRect.left,
      deltaY: targetRect.top - sourceRect.top,
    });
  });

  if (!activeGhosts.length) {
    return;
  }

  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      activeGhosts.forEach(({ ghost, deltaX, deltaY }) => {
        ghost.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      });
      window.setTimeout(resolve, MOVE_ANIMATION_MS + 20);
    });
  });

  activeGhosts.forEach(({ ghost, sourceImage }) => {
    ghost.remove();
    sourceImage.style.visibility = "";
  });
}

function appendMoveToHistory(side, san) {
  if (!san) {
    return;
  }

  if (side === "white") {
    state.moveHistory.push({
      turn: state.moveHistory.length + 1,
      white: san,
      black: "",
    });
    return;
  }

  const lastTurn = state.moveHistory[state.moveHistory.length - 1];
  if (!lastTurn || lastTurn.black) {
    state.moveHistory.push({
      turn: state.moveHistory.length + 1,
      white: "",
      black: san,
    });
    return;
  }

  lastTurn.black = san;
}

function appendPlyToHistory(moveUci) {
  if (!moveUci) {
    return;
  }

  state.plyHistory.push(moveUci);
}

function currentGamePayload() {
  return {
    moves: [...state.plyHistory],
    player_color: state.playerColor,
    skill_level: sanitizeInput(refs.skillLevel, 0, 20, bootstrap.defaultSkillLevel),
    depth: sanitizeInput(refs.depth, 1, 25, bootstrap.defaultDepth),
    starting_fen: bootstrap.initialState.fen,
    session_id: state.gameSessionId,
  };
}

function formatSavedGameDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function playerResultLabel(result) {
  if (result === "win") {
    return "Won";
  }

  if (result === "loss") {
    return "Lost";
  }

  if (result === "draw") {
    return "Draw";
  }

  return "In progress";
}

function derivePlayerResult(boardState) {
  if (!boardState?.game_over) {
    return "in-progress";
  }

  if (boardState.result === "1/2-1/2") {
    return "draw";
  }

  if (boardState.result === "1-0") {
    return state.playerColor === "white" ? "win" : "loss";
  }

  if (boardState.result === "0-1") {
    return state.playerColor === "black" ? "win" : "loss";
  }

  return "draw";
}

function resultOverlayTitle(boardState) {
  const result = derivePlayerResult(boardState);
  if (result === "win") {
    return "You won";
  }

  if (result === "loss") {
    return "You lost";
  }

  if (result === "draw") {
    return "Draw";
  }

  return "";
}

function getResultKingCrowns(boardState, boardMap) {
  if (!isLatestView() || !boardState?.game_over || boardState.result === "1/2-1/2") {
    return new Map();
  }

  const crowns = new Map();
  const whiteKingSquare = [...boardMap.entries()].find(([, piece]) => piece === "K")?.[0];
  const blackKingSquare = [...boardMap.entries()].find(([, piece]) => piece === "k")?.[0];

  if (boardState.result === "1-0") {
    if (whiteKingSquare) {
      crowns.set(whiteKingSquare, "win");
    }
    if (blackKingSquare) {
      crowns.set(blackKingSquare, "loss");
    }
    return crowns;
  }

  if (boardState.result === "0-1") {
    if (whiteKingSquare) {
      crowns.set(whiteKingSquare, "loss");
    }
    if (blackKingSquare) {
      crowns.set(blackKingSquare, "win");
    }
  }

  return crowns;
}

function setCrownState(element, outcome) {
  element.hidden = !outcome;
  element.className = "result-crown";
  if (outcome) {
    element.classList.add(`result-crown--${outcome}`);
  }
}

function syncSavedGame(game) {
  state.savedGames = [
    game,
    ...state.savedGames.filter((savedGame) => savedGame.id !== game.id),
  ].slice(0, 12);
}

async function maybeSaveCompletedGame(boardState) {
  if (!boardState.game_over || state.savedGameId || !state.plyHistory.length) {
    return;
  }

  const data = await fetchJson("/api/games", currentGamePayload());
  state.savedGameId = data.game.id;
  syncSavedGame(data.game);
}

function readFilename(disposition) {
  if (!disposition) {
    return "stockfish-game.pgn";
  }

  const match = disposition.match(/filename="([^"]+)"/i);
  return match ? match[1] : "stockfish-game.pgn";
}

async function downloadCurrentPgn() {
  const response = await fetch("/api/pgn", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(currentGamePayload()),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "PGN download failed");
  }

  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = readFilename(response.headers.get("Content-Disposition"));
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 0);
}

async function appendLiveSnapshot(boardState, moveUci, requestId, options = {}) {
  if (options.animateMove !== false) {
    await animateMoveTransition(moveUci);
  }

  if (requestId !== state.requestSerial) {
    return false;
  }

  state.liveTimeline.push(cloneBoardState(boardState));
  state.displayIndex = state.liveTimeline.length - 1;
  render();
  return true;
}

function renderBoard() {
  const board = getDisplayBoard();
  const boardMap = parseFenBoard(board.fen);
  const availableMoves = canMovePieces()
    ? board.legal_moves
    : getCurrentPremoveLegalMoves();
  const moveIndex = buildMoveIndex(availableMoves);
  const targetMap = getSelectedTargets(moveIndex);
  const lastMoveSquares = getLastMoveSquares();
  const premoveSquares = getPremoveSquares();
  const resultKingCrowns = getResultKingCrowns(board, boardMap);
  const files = getVisibleFiles();
  const ranks = getVisibleRanks();

  refs.board.innerHTML = "";

  ranks.forEach((rank, rankIndex) => {
    files.forEach((file, fileIndex) => {
      const square = `${file}${rank}`;
      const piece = boardMap.get(square);
      const premovePreviewPiece = getPremovePreviewPiece(square, boardMap);
      const renderedPiece = isPremoveSourceSquare(square) ? null : (premovePreviewPiece || piece);
      const targetMoves = targetMap.get(square) || [];

      const button = document.createElement("button");
      button.type = "button";
      button.className = "board-square";
      button.dataset.square = square;
      button.classList.add(
        isLightSquare(file, rank) ? "board-square--light" : "board-square--dark",
      );

      if (state.selectedSquare === square) {
        button.classList.add("board-square--selected");
      }

      if (isMarkedSquare(square)) {
        button.classList.add("board-square--marked");
      }

      if (lastMoveSquares.has(square)) {
        button.classList.add("board-square--last");
      }

      if (board.check_square === square) {
        button.classList.add("board-square--check");
      }

      if (piece && canInteractWithPieces() && isPlayerPiece(piece)) {
        button.classList.add("board-square--draggable");
        if (canMovePieces() && moveIndex.has(square)) {
          button.classList.add("board-square--movable");
        }
      }

      if (targetMoves.length) {
        button.classList.add(
          piece ? "board-square--capture-target" : "board-square--move-target",
        );
      }

      button.setAttribute(
        "aria-label",
        `${square}${piece ? `, ${pieceName(piece)}` : ", empty"}`,
      );

      if (fileIndex === 0) {
        const rankLabel = document.createElement("span");
        rankLabel.className = "coord coord--rank";
        rankLabel.textContent = String(rank);
        button.append(rankLabel);
      }

      if (rankIndex === ranks.length - 1) {
        const fileLabel = document.createElement("span");
        fileLabel.className = "coord coord--file";
        fileLabel.textContent = file;
        button.append(fileLabel);
      }

      if (targetMoves.length) {
        const marker = document.createElement("span");
        marker.className = `square-marker ${piece ? "square-marker--capture" : "square-marker--move"}`;
        button.append(marker);
      }

      if (isMarkedSquare(square)) {
        const annotation = document.createElement("span");
        annotation.className = "square-annotation square-annotation--red";
        button.append(annotation);
      }

      if (premoveSquares.has(square)) {
        const annotation = document.createElement("span");
        annotation.className = `square-annotation square-annotation--premove square-annotation--premove-${premoveSquares.get(square)}`;
        button.append(annotation);
      }

      if (renderedPiece) {
        const image = document.createElement("img");
        image.className = premovePreviewPiece ? "piece piece--premove-preview" : "piece";
        image.src = pieceImage(renderedPiece);
        image.alt = premovePreviewPiece ? `${pieceName(renderedPiece)} premove` : pieceName(renderedPiece);
        if (!premovePreviewPiece) {
          image.dataset.square = square;
        }
        image.draggable = false;
        button.append(image);
      }

      if (resultKingCrowns.has(square)) {
        const crown = document.createElement("span");
        crown.className = `king-result-crown king-result-crown--${resultKingCrowns.get(square)}`;
        crown.setAttribute("aria-hidden", "true");
        crown.innerHTML = `
          <svg class="king-result-crown__icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M4 19h16l-1.3-7.6-4 3.7L12 6l-2.7 9.1-4-3.7L4 19zm2 2h12v-1.5H6z"></path>
          </svg>
        `;
        button.append(crown);
      }

      refs.board.append(button);
    });
  });
}
function renderMoveList() {
  refs.moveList.innerHTML = "";

  if (!state.moveHistory.length) {
    const empty = document.createElement("p");
    empty.className = "move-list__empty";
    empty.textContent = "Make the first move.";
    refs.moveList.append(empty);
    return;
  }

  let plyIndex = 0;

  state.moveHistory.forEach((turn) => {
    const row = document.createElement("div");
    row.className = "move-row";

    const index = document.createElement("span");
    index.className = "move-index";
    index.textContent = `${turn.turn}.`;

    const whiteMove = document.createElement(turn.white ? "button" : "span");
    whiteMove.className = "move-cell";
    if (turn.white) {
      plyIndex += 1;
      whiteMove.type = "button";
      whiteMove.dataset.plyIndex = String(plyIndex);
      whiteMove.classList.add("move-cell--button");
      whiteMove.textContent = turn.white;
      whiteMove.setAttribute("aria-label", `Go to move ${plyIndex}: ${turn.white}`);
      whiteMove.setAttribute("aria-pressed", state.displayIndex === plyIndex ? "true" : "false");
      if (state.displayIndex === plyIndex) {
        whiteMove.classList.add("move-cell--active");
      }
    } else {
      whiteMove.classList.add("move-cell--placeholder");
      whiteMove.textContent = "...";
    }

    const blackMove = document.createElement(turn.black ? "button" : "span");
    blackMove.className = "move-cell";
    if (turn.black) {
      plyIndex += 1;
      blackMove.type = "button";
      blackMove.dataset.plyIndex = String(plyIndex);
      blackMove.classList.add("move-cell--button");
      blackMove.textContent = turn.black;
      blackMove.setAttribute("aria-label", `Go to move ${plyIndex}: ${turn.black}`);
      blackMove.setAttribute("aria-pressed", state.displayIndex === plyIndex ? "true" : "false");
      if (state.displayIndex === plyIndex) {
        blackMove.classList.add("move-cell--active");
      }
    } else {
      blackMove.classList.add("move-cell--placeholder");
      blackMove.textContent = "-";
    }

    row.append(index, whiteMove, blackMove);
    refs.moveList.append(row);
  });
}

function renderSavedGames() {
  refs.savedGames.innerHTML = "";
  refs.savedGamesCount.textContent = `${state.savedGames.length} saved`;

  if (!state.savedGames.length) {
    const empty = document.createElement("p");
    empty.className = "saved-games__empty";
    empty.textContent = "Finished games will appear here.";
    refs.savedGames.append(empty);
    return;
  }

  state.savedGames.forEach((game) => {
    const card = document.createElement("article");
    card.className = "saved-game";

    const topRow = document.createElement("div");
    topRow.className = "saved-game__top";

    const badge = document.createElement("span");
    badge.className = `saved-game__badge saved-game__badge--${game.player_result}`;
    badge.textContent = playerResultLabel(game.player_result);

    const timestamp = document.createElement("span");
    timestamp.className = "saved-game__timestamp";
    timestamp.textContent = formatSavedGameDate(game.created_at);

    topRow.append(badge, timestamp);

    const title = document.createElement("strong");
    title.className = "saved-game__title";
    title.textContent = game.player_color === "white" ? "You as White" : "You as Black";

    const details = document.createElement("p");
    details.className = "saved-game__details";
    details.textContent = `Skill ${game.skill_level} · Depth ${game.depth} · ${game.move_count} ply`;

    const status = document.createElement("p");
    status.className = "saved-game__status";
    status.textContent = game.status;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-button saved-game__download";
    button.dataset.gameId = String(game.id);
    button.textContent = "Download PGN";

    card.append(topRow, title, details, status, button);
    refs.savedGames.append(card);
  });
}

function renderPromotionDialog() {
  refs.promotionOptions.innerHTML = "";

  if (!state.pendingPromotion) {
    refs.promotionDialog.hidden = true;
    return;
  }

  refs.promotionDialog.hidden = false;

  state.pendingPromotion.options.forEach((move) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "promotion-button";
    button.dataset.uci = move.uci;

    const pieceCode = state.playerColor === "white"
      ? move.promotion.toUpperCase()
      : move.promotion;

    const image = document.createElement("img");
    image.src = pieceImage(pieceCode);
    image.alt = pieceName(pieceCode);

    const label = document.createElement("span");
    label.textContent = pieceName(pieceCode).replace("White ", "").replace("Black ", "");

    button.append(image, label);
    refs.promotionOptions.append(button);
  });
}

function renderGameResult() {
  const board = getDisplayBoard();
  const visible = isLatestView() && board.game_over;
  refs.resultOverlay.hidden = !visible;
  setCrownState(refs.playerResultCrown, null);
  setCrownState(refs.engineResultCrown, null);

  if (!visible) {
    refs.resultOverlayTitle.textContent = "";
    return;
  }

  const playerResult = derivePlayerResult(board);
  refs.resultOverlayTitle.textContent = resultOverlayTitle(board);
}

function setEvaluation(evaluation) {
  const currentEvaluation = evaluation || equalEvaluation();
  const label = currentEvaluation.label ?? "n/a";
  refs.evaluationText.textContent = label;
  refs.evalMeterLabel.textContent = label;
  document.documentElement.style.setProperty(
    "--white-share",
    `${evaluationToWhiteShare(currentEvaluation)}%`,
  );
}

function renderSidePicker() {
  refs.playWhite.classList.toggle("side-button--active", state.playerColor === "white");
  refs.playBlack.classList.toggle("side-button--active", state.playerColor === "black");
  refs.playerCardLabel.textContent = state.playerColor === "white" ? "You play White" : "You play Black";
  refs.engineCardLabel.textContent = state.playerColor === "white"
    ? "Stockfish plays Black"
    : "Stockfish plays White";
}

function historyLabelText() {
  if (isLatestView()) {
    return "Live";
  }

  if (state.displayIndex === 0) {
    return "Start";
  }

  return `Ply ${state.displayIndex}/${state.liveTimeline.length - 1}`;
}

function renderHistoryControls() {
  refs.historyBack.disabled = state.busy || state.transitioning || state.displayIndex === 0;
  refs.historyForward.disabled = state.busy || state.transitioning || state.displayIndex >= state.liveTimeline.length - 1;
  refs.historyLabel.textContent = historyLabelText();
}

function deriveStatusText() {
  const board = getDisplayBoard();

  if (!isLatestView()) {
    return `Viewing history. ${board.status}`;
  }

  if (board.game_over) {
    return board.status;
  }

  if (board.in_check && board.turn === state.playerColor) {
    return "Your king is in check.";
  }

  return board.status;
}

function deriveTurnIndicator() {
  const board = getDisplayBoard();

  if (!isLatestView()) {
    return historyLabelText();
  }

  if (board.game_over) {
    return board.result || "Finished";
  }

  if (state.premove && canQueuePremove()) {
    return "Premove set";
  }

  if (state.busy || board.turn !== state.playerColor) {
    return "";
  }

  return "Your turn";
}

function render() {
  renderBoard();
  renderArrows();
  renderCapturedPieces();
  renderMoveList();
  renderSavedGames();
  renderPromotionDialog();
  renderGameResult();
  renderSidePicker();
  renderHistoryControls();
  refs.statusText.textContent = deriveStatusText();
  refs.turnIndicator.textContent = deriveTurnIndicator();
  refs.engineMove.textContent = state.lastEngineMove;
  refs.fenOutput.value = getDisplayBoard().fen;
  refs.error.textContent = state.error;
  refs.downloadPgn.disabled = state.busy || !state.plyHistory.length;
  setEvaluation(state.evaluation);
}

function chooseMove(moveOptions, options = {}) {
  const { inputMethod = "click" } = options;
  const promotionMoves = moveOptions.filter((move) => move.promotion);
  if (promotionMoves.length) {
    state.pendingPromotion = {
      inputMethod,
      options: [...promotionMoves].sort(
        (left, right) => PROMOTION_ORDER.indexOf(left.promotion) - PROMOTION_ORDER.indexOf(right.promotion),
      ),
    };
    render();
    return;
  }

  void submitPlayerMove(moveOptions[0].uci, {
    animateMove: inputMethod !== "drag",
  });
}

async function handleSquareChoice(square) {
  const boardMap = parseFenBoard(getDisplayBoard().fen);
  const piece = boardMap.get(square);
  const premoveMode = canQueuePremove();

  if (!canMovePieces() && !premoveMode) {
    return;
  }

  if (premoveMode) {
    const premoveMoves = await ensurePremoveLegalMoves();
    const premoveMoveIndex = buildMoveIndex(premoveMoves);

    if (state.selectedSquare) {
      if (square === state.selectedSquare) {
        state.selectedSquare = null;
        render();
        return;
      }

      if (piece && isPlayerPiece(piece)) {
        state.selectedSquare = square;
        render();
        return;
      }

      const matchingMoves = (premoveMoveIndex.get(state.selectedSquare) || []).filter(
        (move) => move.to === square,
      );
      if (matchingMoves.length) {
        setPremove(state.selectedSquare, square, { inputMethod: "click" });
        return;
      }

      playSound("illegal");
      return;
    }

    if (piece && isPlayerPiece(piece) && premoveMoveIndex.has(square)) {
      state.error = "";
      state.selectedSquare = square;
      render();
      return;
    }

    state.selectedSquare = null;
    render();
    return;
  }

  const moveIndex = buildMoveIndex(getDisplayBoard().legal_moves);

  if (state.selectedSquare) {
    const matchingMoves = (moveIndex.get(state.selectedSquare) || []).filter(
      (move) => move.to === square,
    );

    if (matchingMoves.length) {
      chooseMove(matchingMoves, { inputMethod: "click" });
      return;
    }
  }

  if (piece && isPlayerPiece(piece) && moveIndex.has(square)) {
    state.error = "";
    state.selectedSquare = state.selectedSquare === square ? null : square;
    render();
    return;
  }

  state.selectedSquare = null;
  render();
}

async function fetchJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function requestEngineTurn(fen, requestId) {
  const previousBoard = cloneBoardState(getLiveBoard());
  const payload = {
    fen,
    skill_level: sanitizeInput(refs.skillLevel, 0, 20, bootstrap.defaultSkillLevel),
    depth: sanitizeInput(refs.depth, 1, 25, bootstrap.defaultDepth),
  };

  const data = await fetchJson("/api/engine-turn", payload);
  if (requestId !== state.requestSerial) {
    return false;
  }

  if (data.engine_san) {
    appendMoveToHistory(engineColor(), data.engine_san);
  }

  const appended = await appendLiveSnapshot(data.board, data.engine_move, requestId);
  if (!appended) {
    return false;
  }

  appendPlyToHistory(data.engine_move);
  playSound(
    soundKeyForMove({
      beforeBoard: previousBoard,
      afterBoard: data.board,
      moveUci: data.engine_move,
      actor: "engine",
    }),
  );
  state.lastEngineMove = data.engine_san || "-";
  state.evaluation = data.evaluation_details || equalEvaluation();
  if (data.board.game_over) {
    clearPremove();
    clearPremoveLegalMoves();
    await maybeSaveCompletedGame(data.board);
    state.busy = false;
    render();
    return true;
  }

  const queuedPremove = state.premove;
  const premoveUci = findLegalPremove(data.board);
  if (queuedPremove) {
    clearPremove();
    if (premoveUci) {
      await submitPlayerMove(premoveUci, {
        animateMove: queuedPremove.inputMethod !== "drag",
      });
      return true;
    }
  }

  clearPremoveLegalMoves();
  state.busy = false;
  render();
  return true;
}

async function submitPlayerMove(uci, options = {}) {
  const previousBoard = cloneBoardState(getLiveBoard());
  const requestId = state.requestSerial + 1;
  state.requestSerial = requestId;
  state.busy = true;
  state.selectedSquare = null;
  state.pendingPromotion = null;
  if (!options.keepPremove) {
    clearPremove();
  }
  clearPieceDrag();
  state.error = "";
  clearAnnotations();
  render();

  const payload = {
    fen: getLiveBoard().fen,
    move: uci,
    player_color: state.playerColor,
  };

  try {
    const data = await fetchJson("/api/player-move", payload);
    if (requestId !== state.requestSerial) {
      return;
    }

    appendMoveToHistory(state.playerColor, data.player_san);
    const appended = await appendLiveSnapshot(data.board, data.player_move, requestId, {
      animateMove: options.animateMove !== false,
    });
    if (!appended || requestId !== state.requestSerial) {
      return;
    }

    appendPlyToHistory(data.player_move);
    playSound(
      soundKeyForMove({
        beforeBoard: previousBoard,
        afterBoard: data.board,
        moveUci: data.player_move,
        actor: "player",
      }),
    );
    if (data.board.game_over) {
      state.busy = false;
      state.evaluation = emptyEvaluation();
      state.lastEngineMove = "-";
      clearPremoveLegalMoves();
      await maybeSaveCompletedGame(data.board);
      render();
      return;
    }

    void preloadPremoveLegalMoves(data.board.fen);
    await requestEngineTurn(data.board.fen, requestId);
  } catch (error) {
    if (requestId !== state.requestSerial) {
      return;
    }

    state.busy = false;
    state.error = error instanceof Error ? error.message : "Move failed";
    playSound("illegal");
    render();
  }
}

async function startNewGame(playerColor = state.playerColor, preserveOrientation = true) {
  const requestId = state.requestSerial + 1;
  state.requestSerial = requestId;
  state.playerColor = playerColor;
  state.orientation = preserveOrientation ? state.orientation : playerColor;
  state.liveTimeline = [cloneBoardState(bootstrap.initialState)];
  state.displayIndex = 0;
  state.selectedSquare = null;
  state.busy = playerColor === "black";
  state.pendingPromotion = null;
  state.moveHistory = [];
  state.plyHistory = [];
  state.evaluation = equalEvaluation();
  state.lastEngineMove = "-";
  state.error = "";
  clearPieceDrag();
  state.transitioning = false;
  clearPremove();
  clearPremoveLegalMoves();
  state.arrows = [];
  state.arrowDraft = null;
  state.savedGameId = null;
  state.gameSessionId = generateSessionId();
  render();
  playSound("gameStart");

  if (playerColor !== "black") {
    return;
  }

  void preloadPremoveLegalMoves(bootstrap.initialState.fen);
  try {
    await requestEngineTurn(bootstrap.initialState.fen, requestId);
  } catch (error) {
    if (requestId !== state.requestSerial) {
      return;
    }

    state.busy = false;
    state.error = error instanceof Error ? error.message : "Stockfish move failed";
    render();
  }
}

async function navigateHistory(delta) {
  if (state.busy || state.transitioning) {
    return;
  }

  const nextIndex = clamp(
    state.displayIndex + delta,
    0,
    state.liveTimeline.length - 1,
    state.displayIndex,
  );

  if (nextIndex === state.displayIndex) {
    return;
  }

  state.selectedSquare = null;
  clearPieceDrag();

  const transition = getTimelineTransition(state.displayIndex, nextIndex);
  if (!transition) {
    state.displayIndex = nextIndex;
    render();
    return;
  }

  const animationBoard = transition.reverse ? transition.afterBoard : transition.beforeBoard;
  const soundKey = soundKeyForMove(transition);
  state.transitioning = true;

  try {
    await animateMoveTransition(transition.moveUci, {
      boardState: animationBoard,
      reverse: transition.reverse,
    });
    state.displayIndex = nextIndex;
  } finally {
    state.transitioning = false;
    render();
  }

  playSound(soundKey);
}

async function goToHistoryIndex(targetIndex) {
  if (state.busy || state.transitioning) {
    return;
  }

  const nextIndex = clamp(
    Number(targetIndex),
    0,
    state.liveTimeline.length - 1,
    state.displayIndex,
  );

  if (nextIndex === state.displayIndex) {
    return;
  }

  if (Math.abs(nextIndex - state.displayIndex) === 1) {
    await navigateHistory(nextIndex - state.displayIndex);
    return;
  }

  state.selectedSquare = null;
  clearPieceDrag();
  state.displayIndex = nextIndex;
  render();
}
function handleBoardClick(event) {
  if (state.transitioning) {
    return;
  }

  if (state.suppressNextClick) {
    state.suppressNextClick = false;
    return;
  }

  const square = getSquareFromTarget(event.target);
  const clearedAnnotations = clearAnnotations();

  if (square) {
    void handleSquareChoice(square);
    return;
  }

  if (clearedAnnotations) {
    render();
  }
}

function handleBoardMouseDown(event) {
  if (state.transitioning) {
    return;
  }

  if (event.button === 2) {
    const square = getSquareFromTarget(event.target);
    if (!square) {
      return;
    }

    event.preventDefault();
    beginArrow(square);
    return;
  }

  if (event.button !== 0 || !canInteractWithPieces()) {
    return;
  }

  const piece = event.target.closest(".piece");
  if (!piece) {
    return;
  }

  const square = piece.dataset.square;
  const boardMap = parseFenBoard(getDisplayBoard().fen);
  const pieceCode = boardMap.get(square);
  if (!pieceCode || !isPlayerPiece(pieceCode)) {
    return;
  }

  state.pendingDrag = {
    square,
    clientX: event.clientX,
    clientY: event.clientY,
  };
}

function handleBoardMouseUp(event) {
  if (event.button !== 2 || !state.arrowDraft) {
    return;
  }

  const square = getSquareFromTarget(event.target);
  event.preventDefault();
  finishArrow(square);
}

async function handleDocumentMouseUp(event) {
  if (event.button === 2) {
    cancelArrowDraft();
    return;
  }

  if (event.button !== 0) {
    return;
  }

  if (state.dragPreview) {
    const sourceSquare = state.dragSource;
    const targetSquare = getSquareFromPoint(event.clientX, event.clientY);
    const moveIndex = buildMoveIndex(getDisplayBoard().legal_moves);
    const matchingMoves = sourceSquare
      ? (moveIndex.get(sourceSquare) || []).filter((move) => move.to === targetSquare)
      : [];

    clearPieceDrag();
    state.suppressNextClick = true;

    if (matchingMoves.length) {
      chooseMove(matchingMoves, { inputMethod: "drag" });
      return;
    }

    if (canQueuePremove() && targetSquare && sourceSquare && targetSquare !== sourceSquare) {
      const premoveMoves = await ensurePremoveLegalMoves();
      const premoveMoveIndex = buildMoveIndex(premoveMoves);
      const premoveMatches = (premoveMoveIndex.get(sourceSquare) || []).filter(
        (move) => move.to === targetSquare,
      );
      if (premoveMatches.length) {
        setPremove(sourceSquare, targetSquare, { inputMethod: "drag" });
        return;
      }
    }

    if (targetSquare && sourceSquare && targetSquare !== sourceSquare) {
      playSound("illegal");
    }

    state.selectedSquare = null;
    render();
    return;
  }

  state.pendingDrag = null;
}

function handleDocumentMouseMove(event) {
  if (state.arrowDraft && (event.buttons & 2) === 2) {
    const square = getSquareFromPoint(event.clientX, event.clientY);
    if (square) {
      updateArrowDraft(square);
    }
  }

  if (state.pendingDrag && !state.dragPreview) {
    const deltaX = event.clientX - state.pendingDrag.clientX;
    const deltaY = event.clientY - state.pendingDrag.clientY;
    if (Math.hypot(deltaX, deltaY) >= 6) {
      activatePieceDrag(state.pendingDrag.square, event.clientX, event.clientY);
    }
  }

  if (state.dragPreview) {
    positionPieceDrag(event.clientX, event.clientY);
  }
}

function handleKeyNavigation(event) {
  if (state.transitioning) {
    return;
  }

  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }

  if (event.target instanceof HTMLElement) {
    const tagName = event.target.tagName.toLowerCase();
    if (tagName === "input" || tagName === "textarea") {
      return;
    }
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    void navigateHistory(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    void navigateHistory(1);
  }
}

refs.board.addEventListener("click", handleBoardClick);
refs.board.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
refs.board.addEventListener("mousedown", handleBoardMouseDown);
refs.board.addEventListener("mouseup", handleBoardMouseUp);
document.addEventListener("mousemove", handleDocumentMouseMove);
document.addEventListener("mouseup", handleDocumentMouseUp);
document.addEventListener("keydown", handleKeyNavigation);
refs.newGame.addEventListener("click", () => {
  void startNewGame(state.playerColor, true);
});
refs.downloadPgn.addEventListener("click", () => {
  void (async () => {
    try {
      state.error = "";
      render();
      await downloadCurrentPgn();
    } catch (error) {
      state.error = error instanceof Error ? error.message : "PGN download failed";
      render();
    }
  })();
});
refs.playWhite.addEventListener("click", () => {
  void startNewGame("white", false);
});
refs.playBlack.addEventListener("click", () => {
  void startNewGame("black", false);
});
refs.flipBoard.addEventListener("click", () => {
  clearPieceDrag();
  state.orientation = state.orientation === "white" ? "black" : "white";
  state.selectedSquare = null;
  render();
});
refs.historyBack.addEventListener("click", () => {
  void navigateHistory(-1);
});
refs.historyForward.addEventListener("click", () => {
  void navigateHistory(1);
});
refs.moveList.addEventListener("click", (event) => {
  const button = event.target.closest(".move-cell--button");
  const plyIndex = button?.dataset.plyIndex;
  if (!plyIndex) {
    return;
  }

  void goToHistoryIndex(plyIndex);
});
refs.cancelPromotion.addEventListener("click", () => {
  state.pendingPromotion = null;
  render();
});
refs.promotionOptions.addEventListener("click", (event) => {
  const uci = event.target.closest(".promotion-button")?.dataset.uci;
  if (!uci) {
    return;
  }

  const inputMethod = state.pendingPromotion?.inputMethod || "click";
  state.pendingPromotion = null;
  void submitPlayerMove(uci, {
    animateMove: inputMethod !== "drag",
  });
});
refs.skillLevel.addEventListener("change", () => {
  sanitizeInput(refs.skillLevel, 0, 20, bootstrap.defaultSkillLevel);
});
refs.depth.addEventListener("change", () => {
  sanitizeInput(refs.depth, 1, 25, bootstrap.defaultDepth);
});
refs.savedGames.addEventListener("click", (event) => {
  const gameId = event.target.closest(".saved-game__download")?.dataset.gameId;
  if (!gameId) {
    return;
  }

  const link = document.createElement("a");
  link.href = `/api/games/${gameId}/pgn`;
  document.body.append(link);
  link.click();
  link.remove();
});

render();


