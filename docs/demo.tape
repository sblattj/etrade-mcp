# docs/demo.tape — README hero demo. Regenerate with:
#   cd <repo root> && vhs docs/demo.tape
#
# Shows the installed `etrade-mcp` bin booting and answering a real MCP
# `initialize` -> `tools/list` handshake (via docs/demo-handshake.mjs) with
# zero E*TRADE credentials beyond dummy placeholders — the server registers
# only its 7 read-only tools since ETRADE_ALLOW_ORDERS is never set.
#
# The setup block below (Hide) builds a throwaway PATH shim so the recording
# can type `etrade-mcp` instead of `node dist/mcp.js` — the shim execs the
# exact same dist/mcp.js this package installs, just reachable by its
# installed bin name. It also clears any E*TRADE env vars that might already
# be exported in the operator's shell before setting harmless sandbox
# placeholders. Must be run with CWD at the repo root (dist/ and docs/ are
# referenced by relative path — no machine-specific absolute paths here).

Output docs/demo.gif

Require node
Require bash

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 640
Set Padding 20
Set Theme "Dracula"
Set WindowBar Colorful
Set TypingSpeed 40ms

Hide
Type "mkdir -p /tmp/etrade-mcp-demo-bin"
Enter
Type `printf '#!/bin/sh\nexec node dist/mcp.js "$@"\n' > /tmp/etrade-mcp-demo-bin/etrade-mcp`
Enter
Type "chmod +x /tmp/etrade-mcp-demo-bin/etrade-mcp"
Enter
Type `export PATH="/tmp/etrade-mcp-demo-bin:$PATH"`
Enter
Type "unset ETRADE_ALLOW_ORDERS ETRADE_SANDBOX_API_KEY ETRADE_SANDBOX_API_SECRET ETRADE_SANDBOX_API_KEY_SECRET ETRADE_PROD_API_KEY ETRADE_PROD_API_SECRET ETRADE_LOGIN_USERNAME ETRADE_LOGIN_PASSWORD ETRADE_TOTP_SECRET"
Enter
Type "export ETRADE_ENV=sandbox ETRADE_SANDBOX_API_KEY=demo-key ETRADE_SANDBOX_API_KEY_SECRET=demo-secret"
Enter
Type `export PS1='$ '`
Enter
Type "clear"
Enter
Show

Sleep 300ms
Type "etrade-mcp --help"
Enter
Sleep 2.5s

Type "node docs/demo-handshake.mjs"
Enter
Sleep 3.5s

Sleep 1.2s
