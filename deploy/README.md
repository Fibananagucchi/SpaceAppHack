# Deploying to Google Cloud (Cloud Run)

> **The public instance now runs on Microsoft Azure** (team decision, 15 November 2026): see [`azure.md`](azure.md).
> This Cloud Run guide stays as an alternative for the same container.

This guide is self-contained. It starts from a clean Windows computer and ends with the public URL of the service. Nothing here needs Docker or Node on your computer: Google Cloud Build builds the container from the repository.

> **Status:** written before the first deployment. The commands follow the Google Cloud documentation but have not yet been run against a real project. If a step fails, keep the full error message and send it to the team.

## What gets deployed

| Piece | Google Cloud product | Notes |
|---|---|---|
| API + web interface (one container) | **Cloud Run service** `trend-detective` | Public HTTPS URL, scales to zero when idle |
| Earthdata token | **Secret Manager** secret `earthdata-token` | Injected as an environment variable; never in the image, the repository or the logs |
| Prepared real data (Europe data cube, trend maps) | **Cloud Storage** bucket, mounted into the service at `/mnt/data` | Survives restarts and redeploys |
| Building the Europe data cube | **Cloud Run job** `build-europe-cube` | Same image; run once, then again when new data is needed |
| Short-lived state (jobs, hot cache) | SQLite on the instance's temporary disk (`/tmp`) | Lost on restart; it is only a cache |

Region used everywhere: **`europe-west1`** (Belgium).

---

## 0. Before you start (team lead)

- A Google Cloud **project with billing enabled** (the team's new account with the free credit). Note the **Project ID** (for example `trend-detective-123456`), not the project name.
- Your Google account must have the **Owner** or **Editor** role on that project.
- The **Earthdata token**, handed over privately by the team lead. Never send it through a public channel or commit it.
- Read access to the GitHub repository (it is private until the submission).

## 1. Install the tools (once)

1. **Git for Windows:** <https://git-scm.com/download/win>. Install with the default options. (GitHub Desktop also works for cloning.)
2. **Google Cloud CLI:** <https://cloud.google.com/sdk/docs/install#windows>. Download and run the installer, keep the default options, and let it run `gcloud init` at the end.
3. Open a new **PowerShell** window and check:
   ```powershell
   git --version
   gcloud --version
   ```

## 2. Sign in and choose the project (once)

```powershell
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud config set run/region europe-west1
```
`gcloud auth login` opens the browser; sign in with the Google account that has access to the project.

## 3. Get the code

```powershell
cd $HOME
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY
```
Replace `OWNER/REPOSITORY` with the team's repository, or clone it with GitHub Desktop and `cd` into that folder.

## 4. Set variables for this PowerShell session

Run this block every time you open a new PowerShell window before the commands below:
```powershell
$PROJECT_ID = gcloud config get-value project
$REGION     = "europe-west1"
$SERVICE    = "trend-detective"
$JOB        = "build-europe-cube"
$BUCKET     = "$PROJECT_ID-trend-data"
$SA_NAME    = "trend-detective-run"
$SA         = "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
"Project: $PROJECT_ID  Region: $REGION  Bucket: $BUCKET"
```

## 5. One-time project setup

### 5.1 Enable the APIs
```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com iam.googleapis.com
```

### 5.2 Budget alert (Console, 2 minutes)
1. Open <https://console.cloud.google.com/billing>, select the billing account, then go to **Budgets & alerts** → **Create budget**.
2. Scope: this project. Amount: for example **50 USD**. Alert thresholds: 25 %, 50 %, 90 %, 100 %. Email alerts go to billing admins.
3. Save.

A budget **only sends emails; it does not stop spending.** How to stop costs is in section 10.

### 5.3 Store the Earthdata token in Secret Manager
1. Open Notepad, paste **only** the token (one line, no spaces), and save it as `C:\temp\earthdata-token.txt`. Create the folder `C:\temp` first if needed.
2. Create the secret from the file, then delete the file:
   ```powershell
   gcloud secrets create earthdata-token --replication-policy=automatic --data-file="C:\temp\earthdata-token.txt"
   Remove-Item "C:\temp\earthdata-token.txt"
   ```
   Using a file keeps the token out of the PowerShell history. Never paste the token into a command line or a chat.

When the token expires (current one: 12 January 2027), add a new version the same way:
```powershell
gcloud secrets versions add earthdata-token --data-file="C:\temp\earthdata-token.txt"
```

### 5.4 Service account for the service and the job
```powershell
gcloud iam service-accounts create $SA_NAME --display-name "Trend Detective runtime"
gcloud secrets add-iam-policy-binding earthdata-token --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
```

### 5.5 Cloud Storage bucket for prepared data
```powershell
gcloud storage buckets create "gs://$BUCKET" --location=$REGION --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role="roles/storage.objectAdmin"
```

## 6. Deploy the service

Run this from the repository folder. The script wraps the `gcloud run deploy` command shown below.
```powershell
.\deploy\deploy-service.ps1
```
If PowerShell blocks scripts, run `Set-ExecutionPolicy -Scope Process Bypass` in the same window first, or run the command by hand:
```powershell
gcloud run deploy $SERVICE --source . --region $REGION --service-account $SA --allow-unauthenticated `
  --execution-environment gen2 `
  --set-secrets "EARTHDATA_TOKEN=earthdata-token:latest" `
  --add-volume "name=data,type=cloud-storage,bucket=$BUCKET,mount-options=implicit-dirs;uid=10001;gid=10001" `
  --add-volume-mount "volume=data,mount-path=/mnt/data" `
  --set-env-vars "DATA_DIR=/mnt/data,RAW_DIR=/mnt/data/raw,STATE_DB=/tmp/state.sqlite" `
  --min-instances 0 --max-instances 1 --cpu 1 --memory 1Gi --cpu-boost --timeout 300
```
- The first deployment asks to create an Artifact Registry repository (`cloud-run-source-deploy`); answer **Y**.
- The build takes about 3–8 minutes. Logs stream in the terminal.
- `--allow-unauthenticated` makes the URL public; the submission requires a public link without login.
- `--max-instances 1` keeps the background jobs and the cache in one instance (architecture A).

## 7. Check that the service is alive

```powershell
$URL = gcloud run services describe $SERVICE --region $REGION --format "value(status.url)"
$URL
Invoke-RestMethod "$URL/api/v1/health?deep=true" | ConvertTo-Json -Depth 6
```
Expected:
- `"status": "ok"`;
- `config.earthdata_token_configured: true` — the secret is connected;
- `config.data_dir_writable: true` — the bucket is mounted;
- `sources.sources.giovanni.status`, `opendap.status`, `eonet.status` all `"ok"` — NASA services accept the token from Google Cloud.

Opening `$URL` in a browser shows a short "Backend is running" page until the frontend is part of the build. The API schema is at `$URL/api/docs`.

## 8. Build the Europe data cube (once, roughly 1.5–3 hours)

The job uses the image that was just deployed:
```powershell
.\deploy\create-cube-job.ps1
```
or by hand:
```powershell
$IMAGE = gcloud run services describe $SERVICE --region $REGION --format "value(spec.template.spec.containers[0].image)"
gcloud run jobs create $JOB --image $IMAGE --region $REGION --service-account $SA `
  --execution-environment gen2 `
  --set-secrets "EARTHDATA_TOKEN=earthdata-token:latest" `
  --add-volume "name=data,type=cloud-storage,bucket=$BUCKET,mount-options=implicit-dirs;uid=10001;gid=10001" `
  --add-volume-mount "volume=data,mount-path=/mnt/data" `
  --set-env-vars "DATA_DIR=/mnt/data,RAW_DIR=/mnt/data/raw" `
  --command "python" --args "-m,backend.pipelines.europe_cube,--products,all,--concurrency,6,--with-maps" `
  --cpu 2 --memory 4Gi --task-timeout 6h --max-retries 1
gcloud run jobs execute $JOB --region $REGION
```
Progress: `Invoke-RestMethod "$URL/api/v1/health" | ConvertTo-Json -Depth 6` → `europe_cube` shows each variable as `downloading` → `assembling` → `ready`. The job resumes where it stopped if you execute it again.

## 9. Update after new commits

```powershell
git pull
.\deploy\deploy-service.ps1
```
If the data pipeline changed, point the job at the new image:
```powershell
$IMAGE = gcloud run services describe $SERVICE --region $REGION --format "value(spec.template.spec.containers[0].image)"
gcloud run jobs update $JOB --image $IMAGE --region $REGION
```

## 10. Demo mode and cost control

| Situation | Command |
|---|---|
| Demo and judging: no cold start | `gcloud run services update $SERVICE --region $REGION --min-instances 1` |
| Back to normal (scale to zero) | `gcloud run services update $SERVICE --region $REGION --min-instances 0` |
| From development step 3 (background jobs need CPU between requests) | `gcloud run services update $SERVICE --region $REGION --no-cpu-throttling` |
| Stop everything | `gcloud run services delete $SERVICE --region $REGION` and `gcloud run jobs delete $JOB --region $REGION` |
| Delete stored data | `gcloud storage rm --recursive "gs://$BUCKET"` |

With `--min-instances 1` and `--no-cpu-throttling` one instance is billed all the time. Check the expected cost in the pricing calculator (<https://cloud.google.com/products/calculator>) against the credit before leaving it on for weeks. Disabling billing for the project (Console → Billing) stops all paid services.

## 11. Logs

```powershell
gcloud run services logs read $SERVICE --region $REGION --limit 100
gcloud run jobs executions list --job $JOB --region $REGION
```
In the Console: **Cloud Run** → service or job → **Logs**. The token is redacted from application logs; do not paste it anywhere to "test".

## 12. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Build fails with a permission error mentioning `...-compute@developer.gserviceaccount.com` | Newer projects build with the Compute Engine default service account. Grant it the Cloud Run builder role: `gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$(gcloud projects describe $PROJECT_ID --format 'value(projectNumber)')-compute@developer.gserviceaccount.com" --role="roles/run.builder"`, then deploy again |
| `--allow-unauthenticated` fails with an organization policy error | The account belongs to an organization that forbids public services. Use the team's personal Google account project |
| Health shows `earthdata_token_configured: false` | The `--set-secrets` flag is missing, or the service account lacks `secretAccessor` (step 5.4) |
| `sources.giovanni.status` is `rejected` | The token is wrong or expired. Add a new secret version (step 5.3) and redeploy |
| `data_dir_writable: false` | The bucket is not mounted, or the service account lacks `storage.objectAdmin` on the bucket (step 5.5) |
| First request after a long pause takes several seconds | Cold start (scale to zero). Use demo mode (section 10) when it matters |
| `gcloud` is not recognized | Open a **new** PowerShell window after installing the Google Cloud CLI |
