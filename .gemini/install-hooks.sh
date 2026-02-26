#!/bin/bash

# PluralMatrix Security Guard Installer 🛡️
# This script installs a pre-push hook that prevents Gemini CLI from pushing to the remote.

HOOK_PATH=".git/hooks/pre-push"

echo "🛡️ Installing PluralMatrix Git Security Guard..."

cat << 'EOF' > "$HOOK_PATH"
#!/bin/bash
if [ "$GEMINI_CLI" = "1" ]; then
  echo ""
  echo "🛑 PLURALMATRIX SECURITY GUARD 🛑"
  echo "Gemini CLI is forbidden from pushing code to this repository."
  echo "To push, please use a standard terminal where GEMINI_CLI is not set."
  echo ""
  exit 1
fi
exit 0
EOF

chmod +x "$HOOK_PATH"

echo "✅ Security Guard installed at $HOOK_PATH"
echo "🚫 I can no longer push to this repository. Only you can!"
