#!/bin/bash
# =============================================================================
# Seed Firestore Database (run after deployment)
# =============================================================================

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-}"

if [ -z "$PROJECT_ID" ]; then
    PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
fi

if [ -z "$PROJECT_ID" ]; then
    echo "Error: No project set."
    echo "Usage: GOOGLE_CLOUD_PROJECT=your-project-id ./scripts/gcp-seed.sh"
    exit 1
fi

echo "Seeding Firestore for project: $PROJECT_ID"
echo ""

cd "$(dirname "$0")/../server"

# Run seed script
GOOGLE_CLOUD_PROJECT="$PROJECT_ID" npx tsx scripts/seed.ts --force

echo ""
echo "Done! Test accounts created."
