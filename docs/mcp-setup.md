# Hostinger Email MCP connector

This repo declares a project-scoped MCP server in `.mcp.json` so that Claude
Code can use Hostinger's email MCP server (`https://mcp.mail.hostinger.com/mcp`)
when working in this project — e.g. to help verify deliverability of the
`index.php` contact form, which sends quote-request emails via Hostinger
Email (see `$MAIL_FROM` in `index.php`).

This is a **development tool for Claude Code sessions**, not something the
PHP site itself calls at runtime — `index.php` sends mail directly via PHP's
`mail()`/SMTP, unrelated to MCP.

## Setup

The server config in `.mcp.json` reads its bearer token from an environment
variable, `HOSTINGER_MCP_TOKEN` — the literal token is intentionally **not**
committed to the repo.

1. Get a Hostinger email API token (Hostinger hPanel → API/Email settings).
2. Export it in your shell before starting Claude Code in this repo:

   ```bash
   export HOSTINGER_MCP_TOKEN="your-token-here"
   ```

   or put it in a local `.env` file (already git-ignored) and source it.
3. Claude Code will prompt to approve the project MCP server on first use;
   approve it to enable the `hostinger-email` tools for this project.

**Never** paste the raw token into a commit, PR description, issue, or chat
message that gets persisted — treat it like a password. If a token has ever
been exposed in plaintext (chat, logs, commit history), revoke and reissue
it from the Hostinger dashboard.
