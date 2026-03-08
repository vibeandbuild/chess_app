# Chess App

A local-first Flask chess app for playing against Stockfish in the browser.

It includes an interactive board, move history, evaluation display, saved finished games, and PGN export, while keeping the engine and local data on your own machine.

## Features

- Play full games against a locally available Stockfish engine
- Click-to-move and drag-to-move board controls
- Choose white or black and start a new game instantly
- Live evaluation display and latest engine move
- Promotion handling in the UI
- Review mode with move history navigation
- Board annotations with marked squares and arrows
- Automatic saving of finished games to a local SQLite database
- PGN download for the current game and saved games
- Optional local sound effects

## Tech stack

- Python
- Flask
- `python-chess`
- Vanilla JavaScript
- Plain CSS

## Requirements

- Python 3.11+ recommended
- A local Stockfish executable

## Quick start

1. Create a virtual environment:

```powershell
python -m venv env
env\Scripts\Activate.ps1
```

2. Install dependencies:

```powershell
pip install -r requirements.txt
```

3. Make sure a Stockfish binary is available.

Default location:

```text
stockfish/stockfish-windows-x86-64-avx2.exe
```

Or point the app at a different engine path:

```powershell
$env:STOCKFISH_PATH="C:\path\to\stockfish.exe"
```

4. Run the app:

```powershell
python app.py
```

5. Open [http://127.0.0.1:5000](http://127.0.0.1:5000).

## Configuration

The app supports a few local environment variables:

- `STOCKFISH_PATH`: override the default engine location
- `CHESS_APP_DB_PATH`: override the SQLite database file path
- `FLASK_DEBUG=1`: enable Flask debug mode

## Local assets and data

- `stockfish/` is intended for your local engine binary and is gitignored.
- `games.db` is created locally and is gitignored.
- `static/sounds/` is optional and is gitignored.
- If the sounds folder is missing, the app still works normally without audio.

## Project layout

```text
app.py
requirements.txt
templates/
  index.html
static/
  app.js
  styles.css
  images/
  sounds/        # optional local-only assets
stockfish/       # local engine binary
```

## Gameplay notes

- Finished games are saved automatically and shown in the archive panel.
- The saved games list is capped in the backend to keep the local archive manageable.
- The board supports keyboard and on-screen navigation when reviewing move history.

## Development

For frontend work, browser-based verification is recommended so board interactions, drag behavior, annotations, and move history can be checked in a real session.

## License

Add a license file before publishing if you want to make the repository open source under specific terms.
