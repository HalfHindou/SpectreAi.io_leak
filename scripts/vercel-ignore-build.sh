#!/bin/bash
# Vercel Ignored Build Step - only build when relevant files change
# https://vercel.com/docs/projects/overview#ignored-build-step
#
# Configure in each Vercel project:
#   Settings > Git > Ignored Build Step: bash scripts/vercel-ignore-build.sh <app-name>
#
# Exit 1 = proceed with build
# Exit 0 = skip build

APP_NAME="$1"

echo "Checking if build is needed for: $APP_NAME"
echo "  branch=${VERCEL_GIT_COMMIT_REF:-unknown} target=${VERCEL_TARGET:-unknown} pr=${VERCEL_GIT_PULL_REQUEST_ID:-none}"

# Skip Preview deploys on non-default branches that don't have an open PR.
# Production deploys always proceed past this check. PR builds always proceed
# (we want preview URLs in PR comments). Direct pushes to dev branches like
# `claude/*`, `feat/*`, `evgeniy`, etc. get skipped - the dev can still get a
# preview by opening a PR.
#
# Vercel exposes:
#   VERCEL_TARGET                   - "production" | "preview" | "development"
#   VERCEL_GIT_COMMIT_REF           - branch name
#   VERCEL_GIT_PULL_REQUEST_ID      - PR number, set only when commit is in a PR
if [ "$VERCEL_TARGET" = "preview" ] && [ -z "$VERCEL_GIT_PULL_REQUEST_ID" ]; then
  case "$VERCEL_GIT_COMMIT_REF" in
    main|master|prod|production)
      # Allow preview-of-default-branch (uncommon but possible via redeploy)
      ;;
    *)
      echo "Skipping preview build on non-PR branch '${VERCEL_GIT_COMMIT_REF}' (open a PR to get a preview)"
      exit 0
      ;;
  esac
fi

# Define which paths trigger a build for each app
case "$APP_NAME" in
  "research")
    PATHS="apps/research packages/server packages/spectre-ui"
    ;;
  "trading")
    PATHS="apps/trading packages/server packages/spectre-ui"
    ;;
  "mission-control")
    PATHS="apps/mission-control"
    ;;
  "developer-control")
    PATHS="developer-control"
    ;;
  *)
    echo "Unknown app: $APP_NAME - building to be safe"
    exit 1
    ;;
esac

# First deploy or missing previous SHA - always build
if [ -z "$VERCEL_GIT_PREVIOUS_SHA" ]; then
  echo "No previous SHA available - building"
  exit 1
fi

# Vercel's clone is shallow - if the previous SHA isn't reachable locally,
# fetch it explicitly. Without this, `git diff` silently returns empty on every
# deploy and the script wrongly reports "no changes", canceling every build.
if ! git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null; then
  echo "Previous SHA $VERCEL_GIT_PREVIOUS_SHA not in shallow clone - fetching"
  git fetch --depth=50 origin "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null || true
fi

# Get list of changed files between previous and current commit.
CHANGED=$(git diff --name-only "$VERCEL_GIT_PREVIOUS_SHA" HEAD 2>/dev/null)
DIFF_EXIT=$?

# If git diff failed (still missing SHA, etc.), don't trust an empty result -
# build to be safe. Skipping a needed build is worse than running an extra one.
if [ "$DIFF_EXIT" -ne 0 ] || ! git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null; then
  echo "git diff against $VERCEL_GIT_PREVIOUS_SHA unavailable - building to be safe"
  exit 1
fi

if [ -z "$CHANGED" ]; then
  echo "No file changes detected - skipping build"
  exit 0
fi

# Check if root config files changed (affects all apps).
# turbo.json is included because its `env` array controls which env vars are
# exposed to the build + serverless functions - a turbo.json-only change (e.g.
# declaring BETA_OPEN) MUST rebuild every app or the new vars never ship.
# This script itself is included so a fix to these trigger rules self-deploys.
if echo "$CHANGED" | grep -qE "^(package\.json|package-lock\.json|turbo\.json|scripts/vercel-ignore-build\.sh|\.env|\.npmrc)$"; then
  echo "Root config changed - building"
  exit 1
fi

# Check if any relevant paths have changes
for PATH_PREFIX in $PATHS; do
  if echo "$CHANGED" | grep -q "^${PATH_PREFIX}/"; then
    echo "Changes detected in $PATH_PREFIX - building"
    exit 1
  fi
done

echo "No relevant changes for $APP_NAME - skipping build"
exit 0
