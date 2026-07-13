# Repository Guidelines

## Project Structure & Module Organization

This is a dependency-free local web application. `server.py` provides the HTTP API, authentication, static-file serving, and SQLite persistence. The browser UI is split by feature: `index.html`/`app.js` for championship administration, `bolao.html`/`bolao.js` for the virtual pool, and `login.html`/`login.js` for administrator access. Shared presentation rules live in `styles.css`. Runtime data is under `data/`; treat `campeonato.db` and `backup-latest.json` as user data, not source fixtures. Startup helpers are `iniciar.bat` and `iniciar.sh`.

## Build, Test, and Development Commands

No build step or third-party package installation is required. Use Python 3.

- `python server.py` starts the app on port 3000 (Windows may use `py -3 server.py`).
- `./iniciar.sh` starts it on macOS/Linux; `iniciar.bat` is the Windows equivalent.
- `python -m py_compile server.py` performs a quick Python syntax check.

Open `http://127.0.0.1:3000`, `/login`, and `/bolao` for manual verification. Stop the server with `Ctrl+C`.

## Coding Style & Naming Conventions

Follow the existing style: four spaces and `snake_case` for Python functions and variables; two spaces, semicolons, `camelCase` functions, and uppercase constants in JavaScript. Keep browser scripts inside strict-mode IIFEs and use `async`/`await` for API calls. Prefer descriptive kebab-case HTML IDs and CSS classes. Preserve UTF-8 Portuguese interface text. No formatter or linter is configured, so keep changes focused and match adjacent code.

## Testing Guidelines

There is currently no automated test suite or coverage threshold. For server changes, run the syntax check and exercise affected API/UI flows. For frontend changes, test public and authenticated states, responsive layouts, and browser console errors. Use a copied database or temporary `data/` state when testing destructive actions; never assume the checked-in database is disposable.

## Commit & Pull Request Guidelines

Git history is not included in this checkout, so no repository-specific commit convention can be inferred. Use short, imperative subjects such as `Fix league score validation`, and keep each commit scoped to one concern. Pull requests should explain behavior changes, list manual verification steps, call out database/schema or configuration effects, and include screenshots for visible UI changes. Link the relevant issue when one exists.

## Security & Configuration

Override administrator credentials with `SINUCA_ADMIN_USER` and `SINUCA_ADMIN_PASSWORD`; never commit real credentials or tokens. Expose port 3000 only on trusted private networks. Back up `data/campeonato.db` before migrations or manual data work.
