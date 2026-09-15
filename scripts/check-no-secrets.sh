#!/usr/bin/env bash
# Pre-commit secret gate for agentic-supremacy.
# Blocks any commit that introduces a private key, .env content, or known key patterns.
set -euo pipefail

STAGED=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$STAGED" ] && exit 0

FAIL=0

# 1. Never stage env files
for f in $STAGED; do
  case "$f" in
    .env|*.env|**/.env*|*.pem|*.key)
      echo "BLOCKED: env/key file staged: $f"
      FAIL=1
      ;;
  esac
done

# 2. Scan staged content for wallet private keys (0x + 64 hex) and mnemonics
if git diff --cached -U0 -- $STAGED 2>/dev/null | grep -E '^\+' | grep -Ev '^\+\+\+' | grep -E '0x[0-9a-fA-F]{64}' | grep -Ev 'ddf252ad|c3d58168|8c5be1e7|e1fffcc4|3067048b|7e644d79|b71d689b'; then
  echo "BLOCKED: 64-hex string looks like a private key in staged changes"
  FAIL=1
fi

# 3. MASTER_KEY / password assignments with literal values
if git diff --cached -U0 -- $STAGED 2>/dev/null | grep -E '^\+' | grep -E '(MASTER_KEY|ADMIN_PASSWORD|PRIVATE_KEY|MNEMONIC)\s*=\s*[^\$<{]'; then
  echo "BLOCKED: literal secret assignment in staged changes"
  FAIL=1
fi

exit $FAIL
