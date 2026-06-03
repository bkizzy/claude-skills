# Phoenix first-time setup + MCP connection

Goal of Phase A: produce two values — a **baseUrl** and (usually) an **apiKey** — and wire them into the user's Claude client as an MCP server named `phoenix`. The MCP server itself is `@arizeai/phoenix-mcp`, run via `npx`; it talks to whatever Phoenix instance the baseUrl points at.

Prerequisite for either client: **Node.js / `npx`** must be installed (the MCP runs as `npx -y @arizeai/phoenix-mcp@latest`). Check with `node -v`. If missing, point the user to https://nodejs.org or `brew install node`.

---

## Step 1 — Identify (or stand up) the Phoenix instance

**Ask for the URL first.** If the user already has Phoenix running, the URL tells you the flavor — don't make them pick from a menu:

| baseUrl looks like | Flavor | apiKey |
|---|---|---|
| `https://app.phoenix.arize.com` | Phoenix Cloud | required (Settings → API Keys) |
| `http://localhost:6006`, `127.0.0.1`, `0.0.0.0` | Local | usually none |
| any other host (e.g. `https://phoenix-….run.app`) | Self-hosted | required if auth enabled |

Echo back what you detected so they can correct you. Only walk through "stand one up" (below) when the user has **no** instance yet — in that case default to recommending Phoenix Cloud.

### Flavor 1: Phoenix Cloud (recommended for first-timers)

Fully hosted, nothing to run locally.

1. Sign up at **https://app.phoenix.arize.com**.
2. In the UI, open **Settings → API Keys** and create a key. Copy it.
3. Values:
   - **baseUrl** = `https://app.phoenix.arize.com`
   - **apiKey** = the key you copied

> Your app still needs to be *sending* traces to this instance for the report to have data. That's instrumentation (e.g. `arize-phoenix-otel` in the app) and is out of scope here — but note it to the user if their projects come back empty.

### Flavor 2: Local (pip or docker)

Runs on the user's machine, good for development. No account, usually no API key.

**pip:**
```bash
pip install arize-phoenix
phoenix serve        # starts the UI/collector on http://localhost:6006
```

**docker:**
```bash
docker run -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
```

- **baseUrl** = `http://localhost:6006`
- **apiKey** = usually **none** for a default local instance. If the user enabled auth (`PHOENIX_ENABLE_AUTH=true`), create a key in Settings → API Keys and use it; otherwise omit the `--apiKey` arg entirely.

Leave the server running while using the report.

### Flavor 3: Self-hosted (their own deployment)

A Phoenix the user already deployed — e.g. on Cloud Run, Fly, a VM, k8s. (Self-hosted URLs often look like `https://phoenix-<id>.us-central1.run.app`.)

1. **baseUrl** = the deployment's HTTPS URL (no trailing path).
2. **apiKey** = from that instance's **Settings → API Keys**. Self-hosted Phoenix with auth enabled requires a key; ask the user to grab one.

Ask the user for both values; don't guess the URL.

---

## Step 2 — Connect to the chosen client

### Client A: Claude Desktop

Edit (create if absent) `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Merge a `phoenix` entry into `mcpServers` (preserve any existing servers — read the file first, add the key, write it back):

```json
{
  "mcpServers": {
    "phoenix": {
      "command": "npx",
      "args": [
        "-y",
        "@arizeai/phoenix-mcp@latest",
        "--baseUrl",
        "<BASE_URL>",
        "--apiKey",
        "<API_KEY>"
      ]
    }
  }
}
```

For a no-auth local instance, drop the `"--apiKey", "<API_KEY>"` pair entirely.

Then: **fully quit Claude Desktop (Cmd-Q, not just close the window) and reopen it.** MCP servers load at launch.

### Client B: Claude Code / Cowork

One command — no file editing. Run it for the user (or print it to run themselves):

```bash
claude mcp add phoenix -- npx -y @arizeai/phoenix-mcp@latest \
  --baseUrl <BASE_URL> --apiKey <API_KEY>
```

Drop `--apiKey <API_KEY>` for a no-auth local instance.

- Add `--scope user` to make it available across all projects (default scope is the current project via `.mcp.json`).
- Verify with `claude mcp list` — `phoenix` should show as connected.

> The API key ends up in the client config / shell history, never in the skill. Don't commit it.

---

## Step 3 — Verify the connection

Call `mcp__phoenix__list-projects`. Success = an array of projects (even an empty `default` is fine — it proves the link works).

### Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Tools never appear in Claude Desktop | Didn't fully quit/reopen; or JSON is malformed (validate it). |
| `401 / 403 / unauthorized` | Wrong or missing apiKey; key lacks read scope; key from a different instance than baseUrl. |
| `ECONNREFUSED` / timeout (local) | `phoenix serve` / docker isn't running, or wrong port. |
| `npx` not found | Node.js not installed. |
| Empty project list | Connection works but no traces ingested yet — that's an instrumentation gap in the user's app, not a setup error. |
