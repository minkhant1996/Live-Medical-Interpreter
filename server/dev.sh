#!/bin/bash
# =============================================================================
# MedInterpreter - Local Development with Firebase/Firestore
# =============================================================================
set -e

PROJECT_ID="${GCP_PROJECT_ID:-dev-hack-mar-2026}"
REGION="${GCP_REGION:-us-central1}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }

# Check gcloud
command -v gcloud >/dev/null 2>&1 || error "gcloud CLI not installed"

# Get project
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
fi
log "Using project: $PROJECT_ID"

# Set project
gcloud config set project "$PROJECT_ID" --quiet

# Enable Firestore API
log "Enabling Firestore API..."
gcloud services enable firestore.googleapis.com --quiet 2>/dev/null || true

# Check/create Firestore database
log "Checking Firestore..."
if ! gcloud firestore databases describe --project="$PROJECT_ID" 2>/dev/null | grep -q "name:"; then
  log "Creating Firestore database..."
  gcloud firestore databases create --location="$REGION" --quiet 2>/dev/null || warn "Firestore may already exist"
fi

# Update .env to use Firestore
log "Configuring .env..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  # Update USE_MEMORY_STORE to false
  if grep -q "USE_MEMORY_STORE" "$ENV_FILE"; then
    sed -i '' 's/USE_MEMORY_STORE=true/USE_MEMORY_STORE=false/' "$ENV_FILE"
  else
    echo "USE_MEMORY_STORE=false" >> "$ENV_FILE"
  fi

  # Ensure project ID is set
  if grep -q "GOOGLE_CLOUD_PROJECT" "$ENV_FILE"; then
    sed -i '' "s/GOOGLE_CLOUD_PROJECT=.*/GOOGLE_CLOUD_PROJECT=$PROJECT_ID/" "$ENV_FILE"
  else
    echo "GOOGLE_CLOUD_PROJECT=$PROJECT_ID" >> "$ENV_FILE"
  fi
fi

log "Firestore configured!"

# Seed database with test users
log "Seeding database..."
cd "$SCRIPT_DIR"
npx tsx seed.ts 2>/dev/null || warn "Seed skipped (may already exist)"

# Kill any existing server on port 8034
log "Checking port 8034..."
lsof -ti :8034 | xargs kill -9 2>/dev/null || true

# Start the server
log "Starting server..."
cd "$SCRIPT_DIR"
npm run dev &
SERVER_PID=$!

# Wait for server to start
sleep 3

# Check if server is running
if lsof -i :8034 >/dev/null 2>&1; then
  echo ""
  log "========================================="
  log "Server running at http://localhost:8034"
  log "Using Firestore project: $PROJECT_ID"
  log "========================================="
  log ""
  log "Press Ctrl+C to stop"

  # Wait for server process
  wait $SERVER_PID
else
  error "Server failed to start. Check logs above."
fi
