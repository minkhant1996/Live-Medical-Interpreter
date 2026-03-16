#!/bin/bash
# =============================================================================
# MedInterpreter - Google Cloud Run Deployment Script
# =============================================================================
# Prerequisites:
#   1. Google Cloud SDK (gcloud) installed: https://cloud.google.com/sdk/docs/install
#   2. Docker installed (for local testing only)
#   3. A GCP project with billing enabled
#   4. Gemini API key stored in Secret Manager as "gemini-api-key"
#
# Required APIs (enabled automatically by this script):
#   - Cloud Run API
#   - Cloud Build API
#   - Artifact Registry API
#   - Text-to-Speech API
#   - Secret Manager API
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# =============================================================================

set -euo pipefail

# ---------- Configuration (edit these) ----------
PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="med-interpreter"
REPO_NAME="med-interpreter-repo"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-}"

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Use git commit SHA for deterministic image tags (enables rollback)
IMAGE_TAG=$(cd "$PROJECT_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "latest")

# ---------- Colors ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }

# ---------- Pre-flight checks ----------
command -v gcloud >/dev/null 2>&1 || error "gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install"

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
  if [ -z "$PROJECT_ID" ]; then
    error "No GCP project set. Run: export GCP_PROJECT_ID=your-project-id"
  fi
  warn "Using project from gcloud config: $PROJECT_ID"
fi

log "Project:  $PROJECT_ID"
log "Region:   $REGION"
log "Service:  $SERVICE_NAME"
log "Image tag: $IMAGE_TAG"
echo ""

# ---------- Step 1: Set project ----------
log "Setting active project..."
gcloud config set project "$PROJECT_ID"

# ---------- Step 2: Enable required APIs ----------
log "Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  texttospeech.googleapis.com \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  --quiet

# ---------- Step 3: Setup Firestore (if needed) ----------
log "Checking Firestore..."
if ! gcloud firestore databases describe --project="$PROJECT_ID" 2>/dev/null; then
  log "Creating Firestore database..."
  gcloud firestore databases create --location="$REGION" --quiet || warn "Firestore may already exist"
fi

# ---------- Step 3b: Setup Secrets ----------
log "Checking secrets..."

# Note: GOOGLE_API_KEY is NOT needed when USE_VERTEX_AI=true
# Vertex AI uses service account credentials automatically

# Create jwt-secret if missing (still needed for auth)
if ! gcloud secrets describe jwt-secret --project="$PROJECT_ID" 2>/dev/null; then
  log "Creating jwt-secret..."
  openssl rand -base64 32 | gcloud secrets create jwt-secret --data-file=- --project="$PROJECT_ID"
fi

# Grant Cloud Run access to secrets
log "Granting secret access to Cloud Run..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding jwt-secret \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" --quiet 2>/dev/null || true

# ---------- Step 4: Create Artifact Registry repo (if needed) ----------
log "Setting up Artifact Registry..."
if ! gcloud artifacts repositories describe "$REPO_NAME" \
  --location="$REGION" --format="value(name)" 2>/dev/null; then
  log "Creating Artifact Registry repository: $REPO_NAME"
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="MedInterpreter container images"
else
  log "Artifact Registry repository already exists."
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:${IMAGE_TAG}"

# ---------- Step 5: Build with Cloud Build ----------
log "Building container image with Cloud Build..."
log "Image: $IMAGE_URI"

# Change to project root where Dockerfile is
cd "$PROJECT_ROOT"

gcloud builds submit \
  --tag "$IMAGE_URI" \
  --timeout=600 \
  --quiet

# ---------- Step 6: Deploy to Cloud Run ----------
log "Deploying to Cloud Run..."

DEPLOY_ARGS=(
  --image "$IMAGE_URI"
  --platform managed
  --region "$REGION"
  --allow-unauthenticated
  --port 8080
  --memory 1Gi
  --cpu 2
  --min-instances 0
  --max-instances 10
  --timeout 300
  --session-affinity
  --set-env-vars "NODE_ENV=production,USE_VERTEX_AI=true,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GCP_REGION=${REGION}"
  --set-secrets "JWT_SECRET=jwt-secret:latest"
  --quiet
)

# Use dedicated service account if specified
if [ -n "$SERVICE_ACCOUNT" ]; then
  DEPLOY_ARGS+=(--service-account "$SERVICE_ACCOUNT")
fi

gcloud run deploy "$SERVICE_NAME" "${DEPLOY_ARGS[@]}"

# ---------- Step 7: Get service URL ----------
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --format="value(status.url)")

echo ""
log "========================================="
log "Deployment complete!"
log "========================================="
log "URL: $SERVICE_URL"
log "Image: $IMAGE_URI"
log ""
log "Test it:"
log "  curl $SERVICE_URL/api/health"
log ""
log "View logs:"
log "  gcloud run services logs read $SERVICE_NAME --region $REGION"
log ""
log "Rollback to previous revision:"
log "  gcloud run services update-traffic $SERVICE_NAME --region $REGION --to-revisions=REVISION_NAME=100"
log ""
log "To delete:"
log "  gcloud run services delete $SERVICE_NAME --region $REGION"
log "========================================="
