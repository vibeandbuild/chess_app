from __future__ import annotations

import hashlib
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import chess
import chess.engine
import chess.pgn
from flask import Flask, jsonify, render_template, request, url_for


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_ENGINE_PATH = BASE_DIR / "stockfish" / "stockfish-windows-x86-64-avx2.exe"
DEFAULT_DB_PATH = BASE_DIR / "games.db"
DEFAULT_SKILL_LEVEL = 5
DEFAULT_DEPTH = 10
MAX_SAVED_GAMES = 12
SOUND_FILE_NAMES = {
    "capture": "capture.mp3",
    "castle": "castle.mp3",
    "gameEnd": "game_end.mp3",
    "gameStart": "game_start.mp3",
    "illegal": "illegal.mp3",
    "moveCheck": "move_check.mp3",
    "moveOpponent": "move_opponent.mp3",
    "movePiece": "move_piece.mp3",
    "notify": "notify.mp3",
    "premove": "premove.mp3",
    "promote": "promote.mp3",
    "tenseconds": "tenseconds.mp3",
}

app = Flask(__name__)


def is_debug_enabled() -> bool:
    return os.environ.get("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}


def get_engine_path() -> Path:
    configured_path = os.environ.get("STOCKFISH_PATH")
    return Path(configured_path) if configured_path else DEFAULT_ENGINE_PATH


def get_database_path() -> Path:
    configured_path = os.environ.get("CHESS_APP_DB_PATH")
    return Path(configured_path) if configured_path else DEFAULT_DB_PATH


def get_sound_files() -> dict[str, str]:
    sounds_dir = BASE_DIR / "static" / "sounds"
    return {
        key: url_for("static", filename=f"sounds/{filename}")
        for key, filename in SOUND_FILE_NAMES.items()
        if (sounds_dir / filename).is_file()
    }


def parse_engine_settings(payload: dict[str, Any]) -> tuple[int, int]:
    try:
        skill_level = int(payload.get("skill_level", DEFAULT_SKILL_LEVEL))
        depth = int(payload.get("depth", DEFAULT_DEPTH))
    except (TypeError, ValueError) as exc:
        raise ValueError("skill_level and depth must be integers") from exc

    if not 0 <= skill_level <= 20:
        raise ValueError("skill_level must be between 0 and 20")

    if not 1 <= depth <= 25:
        raise ValueError("depth must be between 1 and 25")

    return skill_level, depth


def parse_player_color(payload: dict[str, Any]) -> str:
    player_color = str(payload.get("player_color", "white")).strip().lower()
    if player_color not in {"white", "black"}:
        raise ValueError("player_color must be 'white' or 'black'")
    return player_color


def parse_move_list(payload: dict[str, Any]) -> list[str]:
    raw_moves = payload.get("moves")
    if not isinstance(raw_moves, list) or not raw_moves:
        raise ValueError("moves must be a non-empty list of UCI strings")

    moves: list[str] = []
    for raw_move in raw_moves:
        if not isinstance(raw_move, str) or not raw_move.strip():
            raise ValueError("moves must be a non-empty list of UCI strings")
        moves.append(raw_move.strip())

    return moves


def parse_starting_fen(payload: dict[str, Any]) -> str:
    fen = str(payload.get("starting_fen", chess.STARTING_FEN)).strip() or chess.STARTING_FEN
    try:
        chess.Board(fen)
    except ValueError as exc:
        raise ValueError(f"Invalid FEN: {exc}") from exc
    return fen


def color_name(color: chess.Color) -> str:
    return "white" if color == chess.WHITE else "black"


def color_label(color: chess.Color) -> str:
    return "White" if color == chess.WHITE else "Black"


def color_from_name(name: str) -> chess.Color:
    return chess.WHITE if name == "white" else chess.BLACK


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def serialize_timestamp(value: datetime) -> str:
    return value.isoformat()


def ensure_database() -> None:
    database_path = get_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_key TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                player_color TEXT NOT NULL,
                skill_level INTEGER NOT NULL,
                depth INTEGER NOT NULL,
                result TEXT NOT NULL,
                winner TEXT,
                player_result TEXT NOT NULL,
                status TEXT NOT NULL,
                move_count INTEGER NOT NULL,
                pgn TEXT NOT NULL
            )
            """
        )
        connection.commit()


def get_db_connection() -> sqlite3.Connection:
    ensure_database()
    connection = sqlite3.connect(get_database_path())
    connection.row_factory = sqlite3.Row
    return connection


def format_evaluation(score: chess.engine.PovScore | None) -> dict[str, Any]:
    if score is None:
        return {
            "type": None,
            "value": None,
            "centipawns": None,
            "label": "n/a",
        }

    white_score = score.white()
    mate = white_score.mate()
    if mate is not None:
        return {
            "type": "mate",
            "value": mate,
            "centipawns": 100000 if mate > 0 else -100000,
            "label": f"{'+' if mate > 0 else '-'}M{abs(mate)}",
        }

    centipawns = white_score.score()
    if centipawns is None:
        return {
            "type": None,
            "value": None,
            "centipawns": None,
            "label": "n/a",
        }

    return {
        "type": "cp",
        "value": centipawns,
        "centipawns": centipawns,
        "label": f"{centipawns / 100:+.2f}",
    }


def get_outcome_details(board: chess.Board) -> dict[str, Any] | None:
    outcome = board.outcome(claim_draw=True)
    if outcome is None:
        return None

    if outcome.winner is None:
        winner = None
    else:
        winner = color_name(outcome.winner)

    termination = outcome.termination
    if termination == chess.Termination.CHECKMATE:
        winner_text = "White" if winner == "white" else "Black"
        status = f"Checkmate. {winner_text} wins."
    elif termination == chess.Termination.STALEMATE:
        status = "Draw by stalemate."
    elif termination == chess.Termination.INSUFFICIENT_MATERIAL:
        status = "Draw by insufficient material."
    elif termination in {
        chess.Termination.FIFTY_MOVES,
        chess.Termination.SEVENTYFIVE_MOVES,
    }:
        status = "Draw by the fifty-move rule."
    elif termination in {
        chess.Termination.THREEFOLD_REPETITION,
        chess.Termination.FIVEFOLD_REPETITION,
    }:
        status = "Draw by repetition."
    else:
        status = termination.name.replace("_", " ").capitalize() + "."

    return {
        "result": outcome.result(),
        "winner": winner,
        "status": status,
    }


def serialize_board(board: chess.Board, *, last_move: str | None = None) -> dict[str, Any]:
    outcome = get_outcome_details(board)
    check_square = None

    if board.is_check():
        king_square = board.king(board.turn)
        if king_square is not None:
            check_square = chess.square_name(king_square)

    return {
        "fen": board.fen(),
        "turn": color_name(board.turn),
        "legal_moves": [move.uci() for move in board.legal_moves],
        "game_over": outcome is not None,
        "result": outcome["result"] if outcome else None,
        "winner": outcome["winner"] if outcome else None,
        "status": outcome["status"] if outcome else (
            "White to move." if board.turn == chess.WHITE else "Black to move."
        ),
        "in_check": board.is_check(),
        "check_square": check_square,
        "last_move": last_move,
        "halfmove_clock": board.halfmove_clock,
        "fullmove_number": board.fullmove_number,
    }


def compute_player_result(winner: str | None, player_color: str) -> str:
    if winner is None:
        return "draw"
    return "win" if winner == player_color else "loss"


def compute_game_key(
    *,
    session_id: str,
    player_color: str,
    skill_level: int,
    depth: int,
    starting_fen: str,
    moves: list[str],
) -> str:
    fingerprint = "||".join(
        [
            session_id or "no-session",
            player_color,
            str(skill_level),
            str(depth),
            starting_fen,
            *moves,
        ]
    )
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


def build_pgn_payload(
    payload: dict[str, Any],
    *,
    require_finished: bool,
) -> dict[str, Any]:
    player_color = parse_player_color(payload)
    skill_level, depth = parse_engine_settings(payload)
    moves = parse_move_list(payload)
    starting_fen = parse_starting_fen(payload)
    session_id = str(payload.get("session_id", "")).strip()
    now = utc_now()

    board = chess.Board(starting_fen)
    game = chess.pgn.Game()
    game.headers["Event"] = "Local Stockfish Game"
    game.headers["Site"] = "Local Flask App"
    game.headers["Date"] = now.strftime("%Y.%m.%d")
    game.headers["Round"] = "-"
    game.headers["White"] = "You" if player_color == "white" else "Stockfish"
    game.headers["Black"] = "Stockfish" if player_color == "white" else "You"
    game.headers["StockfishSkillLevel"] = str(skill_level)
    game.headers["StockfishDepth"] = str(depth)

    if starting_fen != chess.STARTING_FEN:
        game.headers["SetUp"] = "1"
        game.headers["FEN"] = starting_fen

    node = game
    for move_text in moves:
        try:
            move = chess.Move.from_uci(move_text)
        except ValueError as exc:
            raise ValueError(f"Invalid move '{move_text}': {exc}") from exc

        if move not in board.legal_moves:
            raise ValueError(f"Illegal move '{move_text}' for the current position")

        node = node.add_variation(move)
        board.push(move)

    outcome_details = get_outcome_details(board)
    if require_finished and outcome_details is None:
        raise ValueError("The game is not finished yet")

    game.headers["Result"] = outcome_details["result"] if outcome_details else "*"
    if outcome_details:
        game.headers["Termination"] = outcome_details["status"]

    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    winner = outcome_details["winner"] if outcome_details else None

    return {
        "game_key": compute_game_key(
            session_id=session_id,
            player_color=player_color,
            skill_level=skill_level,
            depth=depth,
            starting_fen=starting_fen,
            moves=moves,
        ),
        "created_at": serialize_timestamp(now),
        "player_color": player_color,
        "skill_level": skill_level,
        "depth": depth,
        "result": outcome_details["result"] if outcome_details else "*",
        "winner": winner,
        "player_result": compute_player_result(winner=winner, player_color=player_color)
        if outcome_details
        else "ongoing",
        "status": outcome_details["status"] if outcome_details else "Game in progress.",
        "move_count": len(moves),
        "pgn": game.accept(exporter).strip() + "\n",
    }


def serialize_saved_game(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "player_color": row["player_color"],
        "skill_level": row["skill_level"],
        "depth": row["depth"],
        "result": row["result"],
        "winner": row["winner"],
        "player_result": row["player_result"],
        "status": row["status"],
        "move_count": row["move_count"],
    }


def get_saved_game_row(game_id: int) -> sqlite3.Row | None:
    with get_db_connection() as connection:
        return connection.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()


def get_saved_game_by_key(game_key: str) -> sqlite3.Row | None:
    with get_db_connection() as connection:
        return connection.execute("SELECT * FROM games WHERE game_key = ?", (game_key,)).fetchone()


def list_saved_games(limit: int = MAX_SAVED_GAMES) -> list[dict[str, Any]]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, created_at, player_color, skill_level, depth, result, winner,
                   player_result, status, move_count
            FROM games
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [serialize_saved_game(row) for row in rows]


def save_finished_game(payload: dict[str, Any]) -> dict[str, Any]:
    game_data = build_pgn_payload(payload, require_finished=True)

    with get_db_connection() as connection:
        connection.execute(
            """
            INSERT OR IGNORE INTO games (
                game_key,
                created_at,
                player_color,
                skill_level,
                depth,
                result,
                winner,
                player_result,
                status,
                move_count,
                pgn
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                game_data["game_key"],
                game_data["created_at"],
                game_data["player_color"],
                game_data["skill_level"],
                game_data["depth"],
                game_data["result"],
                game_data["winner"],
                game_data["player_result"],
                game_data["status"],
                game_data["move_count"],
                game_data["pgn"],
            ),
        )
        connection.commit()

    saved_row = get_saved_game_by_key(game_data["game_key"])
    if saved_row is None:
        raise RuntimeError("Game could not be saved")

    return serialize_saved_game(saved_row)


def build_pgn_download_response(pgn_text: str, filename: str):
    response = app.response_class(pgn_text, mimetype="application/x-chess-pgn")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def build_pgn_filename(*, player_color: str, player_result: str, created_at: str) -> str:
    try:
        timestamp = datetime.fromisoformat(created_at)
    except ValueError:
        stamp = "game"
    else:
        stamp = timestamp.strftime("%Y%m%d-%H%M%S")

    return f"stockfish-{player_color}-{player_result}-{stamp}.pgn"


def analyze_engine_turn(board: chess.Board, skill_level: int, depth: int) -> dict[str, Any]:
    engine_path = get_engine_path()
    if not engine_path.exists():
        raise FileNotFoundError(
            "Stockfish executable not found. Install it in stockfish/ or set STOCKFISH_PATH."
        )

    with chess.engine.SimpleEngine.popen_uci(str(engine_path)) as engine:
        engine.configure({"Skill Level": skill_level})
        result = engine.play(
            board,
            chess.engine.Limit(depth=depth),
            info=chess.engine.INFO_SCORE,
        )

    if result.move is None:
        raise chess.engine.EngineError("Stockfish did not return a move")

    evaluation_details = format_evaluation(result.info.get("score"))
    return {
        "move": result.move,
        "evaluation": evaluation_details["centipawns"],
        "evaluation_details": evaluation_details,
    }


def execute_engine_turn(board: chess.Board, skill_level: int, depth: int) -> dict[str, Any]:
    if board.is_game_over(claim_draw=True):
        return {
            "engine_move": None,
            "engine_san": None,
            "evaluation": None,
            "evaluation_details": format_evaluation(None),
            "board": serialize_board(board),
        }

    engine_result = analyze_engine_turn(board=board, skill_level=skill_level, depth=depth)
    engine_move = engine_result["move"]
    engine_san = board.san(engine_move)
    board.push(engine_move)

    return {
        "engine_move": engine_move.uci(),
        "engine_san": engine_san,
        "evaluation": engine_result["evaluation"],
        "evaluation_details": engine_result["evaluation_details"],
        "board": serialize_board(board, last_move=engine_move.uci()),
    }


def apply_player_move(board: chess.Board, move_text: str, player_color: str) -> dict[str, Any]:
    if not move_text:
        raise ValueError("A move in UCI format is required")

    expected_turn = color_from_name(player_color)
    if board.turn != expected_turn:
        raise ValueError(f"It is not {color_label(expected_turn)}'s turn")

    try:
        player_move = chess.Move.from_uci(move_text)
    except ValueError as exc:
        raise ValueError(f"Invalid move: {exc}") from exc

    if player_move not in board.legal_moves:
        raise ValueError("Illegal move for the current position")

    player_san = board.san(player_move)
    board.push(player_move)

    return {
        "player_move": player_move.uci(),
        "player_san": player_san,
        "board": serialize_board(board, last_move=player_move.uci()),
    }


def analyze_position(fen: str, skill_level: int, depth: int) -> dict[str, object]:
    board = chess.Board(fen)
    engine_result = analyze_engine_turn(board=board, skill_level=skill_level, depth=depth)

    return {
        "fen": board.fen(),
        "best_move": engine_result["move"].uci(),
        "evaluation": engine_result["evaluation"],
        "evaluation_details": engine_result["evaluation_details"],
        "evaluation_display": engine_result["evaluation_details"]["label"],
        "skill_level": skill_level,
        "depth": depth,
    }


@app.get("/")
def index():
    return render_template(
        "index.html",
        default_fen=chess.STARTING_FEN,
        default_skill_level=DEFAULT_SKILL_LEVEL,
        default_depth=DEFAULT_DEPTH,
        initial_state=serialize_board(chess.Board()),
        saved_games=list_saved_games(),
        sound_files=get_sound_files(),
    )


@app.post("/api/engine-move")
def engine_move():
    payload = request.get_json(silent=True) or {}
    fen = payload.get("fen", chess.STARTING_FEN)

    try:
        skill_level, depth = parse_engine_settings(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        analysis = analyze_position(fen=fen, skill_level=skill_level, depth=depth)
    except ValueError as exc:
        return jsonify({"error": f"Invalid FEN: {exc}"}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500
    except chess.engine.EngineError as exc:
        return jsonify({"error": f"Stockfish error: {exc}"}), 500

    return jsonify(analysis)


@app.post("/api/player-move")
def player_move():
    payload = request.get_json(silent=True) or {}
    fen = payload.get("fen", chess.STARTING_FEN)
    move_text = str(payload.get("move", "")).strip()

    try:
        player_color = parse_player_color(payload)
        board = chess.Board(fen)
        result = apply_player_move(board=board, move_text=move_text, player_color=player_color)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(result)


@app.post("/api/engine-turn")
def engine_turn():
    payload = request.get_json(silent=True) or {}
    fen = payload.get("fen", chess.STARTING_FEN)

    try:
        skill_level, depth = parse_engine_settings(payload)
        board = chess.Board(fen)
        result = execute_engine_turn(board=board, skill_level=skill_level, depth=depth)
    except ValueError as exc:
        return jsonify({"error": f"Invalid request: {exc}"}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500
    except chess.engine.EngineError as exc:
        return jsonify({"error": f"Stockfish error: {exc}"}), 500

    return jsonify(result)


@app.post("/api/play-move")
def play_move():
    payload = request.get_json(silent=True) or {}
    fen = payload.get("fen", chess.STARTING_FEN)
    move_text = str(payload.get("move", "")).strip()

    try:
        skill_level, depth = parse_engine_settings(payload)
        player_color = parse_player_color(payload)
        board = chess.Board(fen)
        player_result = apply_player_move(board=board, move_text=move_text, player_color=player_color)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    player_board = player_result["board"]
    if board.is_game_over(claim_draw=True):
        return jsonify(
            {
                **player_result,
                "player_board": player_board,
                "engine_move": None,
                "engine_san": None,
                "engine_board": player_board,
                "board": player_board,
                "evaluation": None,
                "evaluation_details": format_evaluation(None),
            }
        )

    try:
        engine_result = execute_engine_turn(board=board, skill_level=skill_level, depth=depth)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500
    except chess.engine.EngineError as exc:
        return jsonify({"error": f"Stockfish error: {exc}"}), 500

    return jsonify(
        {
            **player_result,
            "player_board": player_board,
            **engine_result,
            "engine_board": engine_result["board"],
            "board": engine_result["board"],
        }
    )


@app.get("/api/games")
def games():
    limit = request.args.get("limit", default=MAX_SAVED_GAMES, type=int) or MAX_SAVED_GAMES
    limit = max(1, min(limit, 50))
    return jsonify({"games": list_saved_games(limit=limit)})


@app.post("/api/games")
def save_game():
    payload = request.get_json(silent=True) or {}

    try:
        saved_game = save_finished_game(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify({"game": saved_game})


@app.post("/api/pgn")
def download_pgn():
    payload = request.get_json(silent=True) or {}

    try:
        game_data = build_pgn_payload(payload, require_finished=False)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    filename = build_pgn_filename(
        player_color=game_data["player_color"],
        player_result=game_data["player_result"],
        created_at=game_data["created_at"],
    )
    return build_pgn_download_response(game_data["pgn"], filename)


@app.get("/api/games/<int:game_id>/pgn")
def download_saved_game_pgn(game_id: int):
    row = get_saved_game_row(game_id)
    if row is None:
        return jsonify({"error": "Game not found"}), 404

    filename = build_pgn_filename(
        player_color=row["player_color"],
        player_result=row["player_result"],
        created_at=row["created_at"],
    )
    return build_pgn_download_response(row["pgn"], filename)


if __name__ == "__main__":
    ensure_database()
    app.run(debug=is_debug_enabled())
