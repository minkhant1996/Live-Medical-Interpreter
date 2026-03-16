#!/bin/bash
# =============================================================================
# Check GCP Deployment Status
# =============================================================================

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-}"
REGION="${CLOUD_RUN_REGION:-us-central1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-medical-interpreter}"

if [ -z "$PROJECT_ID" ]; then
    PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
fi

if [ -z "$PROJECT_ID" ]; then
    echo "Error: No project set. Run: export GOOGLE_CLOUD_PROJECT=your-project-id"
    exit 1
fi

echo ""
echo "=== GCP Deployment Status ==="
echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo "Service: $SERVICE_NAME"
echo ""

echo "--- Cloud Run Service ---"
gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format "table(status.url,status.conditions[0].status,metadata.annotations['run.googleapis.com/client-name'])" \
    2>/dev/null || echo "Service not found"

echo ""
echo "--- Recent Revisions ---"
gcloud run revisions list \
    --service "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format "table(metadata.name,status.conditions[0].status,metadata.creationTimestamp)" \
    --limit 5 \
    2>/dev/null || echo "No revisions found"

echo ""
echo "--- Logs (last 10 lines) ---"
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --limit 10 \
    --format "table(timestamp,textPayload)" \
    2>/dev/null || echo "No logs found"

echo ""
