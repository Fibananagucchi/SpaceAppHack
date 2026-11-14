# Deploys (or updates) the Cloud Run service from the repository source.
# Run from the repository root:  .\deploy\deploy-service.ps1
# Prerequisites: steps 1-5 of deploy/README.md (APIs, secret, service account, bucket).

# gcloud prints progress on stderr; failures are detected through $LASTEXITCODE below.
$ErrorActionPreference = "Continue"

$PROJECT_ID = "$(gcloud config get-value project)".Trim()
if (-not $PROJECT_ID) { throw "No project set. Run: gcloud config set project YOUR_PROJECT_ID" }
$REGION  = if ($env:TD_REGION)  { $env:TD_REGION }  else { "europe-west1" }
$SERVICE = if ($env:TD_SERVICE) { $env:TD_SERVICE } else { "trend-detective" }
$BUCKET  = "$PROJECT_ID-trend-data"
$SA      = "trend-detective-run@$PROJECT_ID.iam.gserviceaccount.com"

if (-not (Test-Path ".\Dockerfile")) { throw "Run this script from the repository root (Dockerfile not found)." }

Write-Host "Deploying service '$SERVICE' to project '$PROJECT_ID' in '$REGION' (bucket gs://$BUCKET)..."

gcloud run deploy $SERVICE `
  --source . `
  --region $REGION `
  --service-account $SA `
  --allow-unauthenticated `
  --execution-environment gen2 `
  --set-secrets "EARTHDATA_TOKEN=earthdata-token:latest" `
  --add-volume "name=data,type=cloud-storage,bucket=$BUCKET,mount-options=implicit-dirs;uid=10001;gid=10001" `
  --add-volume-mount "volume=data,mount-path=/mnt/data" `
  --set-env-vars "DATA_DIR=/mnt/data,RAW_DIR=/mnt/data/raw,STATE_DB=/tmp/state.sqlite" `
  --min-instances 0 `
  --max-instances 1 `
  --cpu 1 `
  --memory 1Gi `
  --cpu-boost `
  --timeout 300
if ($LASTEXITCODE -ne 0) { throw "gcloud run deploy failed (exit code $LASTEXITCODE). See deploy/README.md, section 12." }

$URL = "$(gcloud run services describe $SERVICE --region $REGION --format "value(status.url)")".Trim()
Write-Host "Service URL: $URL"
Write-Host "Checking health (live source checks)..."
Invoke-RestMethod "$URL/api/v1/health?deep=true" | ConvertTo-Json -Depth 6
