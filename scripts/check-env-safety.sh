#!/usr/bin/env bash
# Pre-commit safety check: prevent committing real secrets
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
FAIL=0

# Patterns that indicate real credentials (not placeholders)
check_file() {
  local file="$1"
  [ -f "$file" ] || return 0

  # Real MongoDB credentials (username:password@cluster pattern)
  if grep -qE 'mongodb\+srv://[a-zA-Z0-9]+:[a-zA-Z0-9]+@[a-z0-9]+\.' "$file" 2>/dev/null; then
    if ! grep -qE '<username>|<password>|YOUR_' "$file" 2>/dev/null; then
      echo -e "${RED}✗ $file contains real MongoDB credentials${NC}"
      FAIL=1
    fi
  fi

  # Real private keys (64 hex chars)
  if grep -qE "PRIVATE_KEY\s*=\s*'[0-9a-fA-F]{64}'" "$file" 2>/dev/null; then
    echo -e "${RED}✗ $file contains a real private key${NC}"
    FAIL=1
  fi

  # Real Infura/Alchemy keys in RPC URLs
  if grep -qE 'infura\.io/v3/[0-9a-f]{32}' "$file" 2>/dev/null; then
    echo -e "${RED}✗ $file contains a real Infura API key${NC}"
    FAIL=1
  fi
}

# Check staged files that might contain secrets
for f in .env.example docs/*.md README.md; do
  check_file "$f"
done

# Ensure .env is never committed
if git ls-files --cached --error-unmatch .env >/dev/null 2>&1; then
  echo -e "${RED}✗ .env is tracked by git! Run: git rm --cached .env${NC}"
  FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then
  echo -e "\n${RED}Security check failed. Fix issues above before committing.${NC}"
  exit 1
else
  echo -e "${GREEN}✓ No secrets detected in tracked files${NC}"
fi
