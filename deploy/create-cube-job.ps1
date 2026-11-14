# Creates (or updates) and runs the Cloud Run job that builds the Europe data cube
# from NASA GES DISC OPeNDAP into the Cloud Storage bucket.
# Run from the repository root after deploy-service.ps1:  .\deploy\create-cube-job.ps1

# gcloud prints progress on stderr; failures are detected through $LASTEXITCODE below.
$ErrorActionPreference = "Continue"

$PROJECT_ID = "$(gcloud config get-value project)".Trim()
if (-not $PROJECT_ID) { throw "No project set. Run: gcloud config set project YOUR_PROJECT_ID" }
$REGION  = if ($env:TD_REGION)  { $env:TD_REGION }  else { "europe-west1" }
$SERVICE = if ($env:TD_SERVICE) { $env:TD_SERVICE } else { "trend-detective" }
$JOB     = "build-europe-cube"
$BUCKET  = "$PROJECT_ID-trend-data"
$SA      = "trend-detective-run@$PROJECT_ID.iam.gserviceaccount.com"

$IMAGE = "$(gcloud run services describe $SERVICE --region $REGION --format "value(spec.template.spec.containers[0].image)")".Trim()
if (-not $IMAGE) { throw "Service '$SERVICE' not found. Run deploy-service.ps1 first." }
Write-Host "Using image: $IMAGE"

$exists = gcloud run jobs list --region $REGION --filter "metadata.name=$JOB" --format "value(metadata.name)"
$verb = if ($exists) { "update" } else { "create" }

gcloud run jobs $verb $JOB `
  --image $IMAGE `
  --region $REGION `
  --service-account $SA `
  --execution-environment gen2 `
  --set-secrets "EARTHDATA_TOKEN=earthdata-token:latest" `
  --add-volume "name=data,type=cloud-storage,bucket=$BUCKET,mount-options=implicit-dirs;uid=10001;gid=10001" `
  --add-volume-mount "volume=data,mount-path=/mnt/data" `
  --set-env-vars "DATA_DIR=/mnt/data,RAW_DIR=/mnt/data/raw" `
  --command "python" `
  --args "-m,backend.pipelines.europe_cube,--products,all,--concurrency,6,--with-maps" `
  --cpu 2 `
  --memory 4Gi `
  --task-timeout 6h `
  --max-retries 1
if ($LASTEXITCODE -ne 0) { throw "gcloud run jobs $verb failed (exit code $LASTEXITCODE)." }

gcloud run jobs execute $JOB --region $REGION
if ($LASTEXITCODE -ne 0) { throw "gcloud run jobs execute failed (exit code $LASTEXITCODE)." }
Write-Host "Job started. Follow progress via /api/v1/health (europe_cube) or: gcloud run jobs executions list --job $JOB --region $REGION"
