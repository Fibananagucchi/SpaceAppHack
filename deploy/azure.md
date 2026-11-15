# Running the service on Microsoft Azure

The public instance runs on Azure. This guide is for the team member who maintains it. It covers how to:
- update the running container after new commits;
- set the environment and the Earthdata secret;
- keep one instance always running for background jobs;
- check that everything works.

> **Status:** written from the Azure documentation (links at the end). It has **not** been run against the team's Azure
> resources, and the names below are placeholders. If a step fails, keep the full error message and send it to the team.
> This guide creates no accounts and stores no credentials.

The image is the repository's `Dockerfile`: one container with the API under `/api/v1` and the web interface under `/`.
It listens on port **8080**.

---

## 0. Which Azure service runs it?

Open the Azure Portal → the resource of the app → **Overview**. The resource type is one of:

| Resource type shown | Service | Use section |
|---|---|---|
| **App Service** (Web App, "Publishing model: Container") | Azure App Service, Web App for Containers | **A** |
| **Container App** | Azure Container Apps | **B** |

Set these once per PowerShell window, with your names. The registry is only needed if the image is built in
Azure Container Registry:
```powershell
$RG  = "YOUR_RESOURCE_GROUP"
$APP = "YOUR_APP_NAME"            # the Web App or the Container App
$ACR = "YOUR_REGISTRY_NAME"       # Azure Container Registry, without .azurecr.io
az login
az account show --output table    # check that the right subscription is selected
```
Install the Azure CLI first if needed: <https://learn.microsoft.com/cli/azure/install-azure-cli-windows>.

## 1. What the image must contain (check before every update)

The Dockerfile copies these into the image. They are in the repository:

| Needed for | Path in the repository | Path in the image |
|---|---|---|
| Europe trend maps (7 files) | `data/prepared/maps/europe/*.json.gz` | `/app/prepared/maps/europe/` |
| Europe globe frames (7 files) | `data/prepared/globe/europe/*.json.gz` | `/app/prepared/globe/europe/` |
| 1° globe trend (7 files) | `data/prepared/globe/europe/trend/*.json.gz` | `/app/prepared/globe/europe/trend/` |
| Curated known events | `backend/app/data/known_events.json` | `/app/backend/app/data/` |
| Web interface | built from `frontend/` in the first Docker stage | `/app/frontend_dist/` |

Before you build, make sure these files are committed, pulled and present. After deploying, section 5 checks them through the API.

## 2. Environment variables

| Name | Value | Notes |
|---|---|---|
| `EARTHDATA_TOKEN` | the NASA Earthdata token | **Secret.** See section 3. Never put it in the image, the repository, a command line or a chat. |
| `WEBSITES_PORT` | `8080` | **App Service only.** Tells App Service which port the container listens on. |
| `DATA_DIR` | `/mnt/data` (with a storage mount, section 6) | Optional. Without it the service uses `/app/data` inside the container (lost on restart) and serves maps and globe from the copies in the image. |
| `RAW_DIR` | `/mnt/data/raw` | Only together with `DATA_DIR` and when the cube is built in Azure. |
| `STATE_DB` | leave unset (`/tmp/state.sqlite`) | Jobs and hot cache. Keep it on local disk: SQLite does not work reliably on network file shares. |

The image already sets `APP_LOAD_DOTENV=0`, `PORT=8080` and `FRONTEND_DIST`; do not change them.

## 3. The Earthdata token as a secret

The token expires (current one: 12 January 2027). Repeat this step with the new token when it does.

To keep the token out of the PowerShell history, put it in a file first:
1. Paste **only** the token into Notepad and save it as `C:\temp\earthdata-token.txt`.
2. Load it into a variable; the history then records only `$token`:
   ```powershell
   $token = (Get-Content "C:\temp\earthdata-token.txt" -Raw).Trim()
   ```
3. Run A or B below.
4. Remove the file and the variable:
   ```powershell
   Remove-Item "C:\temp\earthdata-token.txt"; Remove-Variable token
   ```

**A. App Service.** App settings are encrypted at rest and hidden in the Portal by default:
```powershell
az webapp config appsettings set -g $RG -n $APP --settings "EARTHDATA_TOKEN=$token" WEBSITES_PORT=8080
```
If the team uses Azure Key Vault, put a reference in the setting instead of the value:
`@Microsoft.KeyVault(SecretUri=https://VAULT.vault.azure.net/secrets/earthdata-token/)`. This needs a managed identity with the
"Key Vault Secrets User" role.

**B. Container Apps.** Store the token as a secret and reference it from the variable:
```powershell
az containerapp secret set -g $RG -n $APP --secrets "earthdata-token=$token"
az containerapp update -g $RG -n $APP --set-env-vars "EARTHDATA_TOKEN=secretref:earthdata-token"
```
Changing a secret value alone does not restart the app. The `update` creates a new revision that reads it.

The Portal works as well: **App Service** → Settings → Environment variables. **Container App** → Settings → Secrets,
then Containers → Environment variables → "Reference a secret".

## 4. Update the running container after new commits

1. Pull the latest code: `git pull`, or **Fetch / Pull** in GitHub Desktop.
2. Build a new image **in Azure**. No local Docker is needed: ACR Tasks builds from the repository folder.
   ```powershell
   $TAG = "trend-detective:" + (Get-Date -Format "yyyyMMdd-HHmm")
   az acr build -r $ACR -t $TAG .
   $IMAGE = "$ACR.azurecr.io/$TAG"
   ```
   The build takes about 5–10 minutes (frontend `npm ci` + Python packages). A new tag each time makes it obvious which version runs.
3. Point the app at the new image.

   **A. App Service:**
   ```powershell
   az webapp config container set -g $RG -n $APP --container-image-name $IMAGE --container-registry-url "https://$ACR.azurecr.io"
   az webapp restart -g $RG -n $APP
   ```
   If this reports a registry authentication error, set the registry access up the same way the app was created.
   Portal → **Deployment Center** shows it (managed identity or admin credentials). You can also change the tag there
   instead of using the command.
   If the Web App pulls a fixed tag such as `:latest` with **Deployment Center → Continuous deployment** on, build with
   `-t trend-detective:latest`. App Service then pulls the new image by itself; restart if it does not.

   **B. Container Apps:**
   ```powershell
   az containerapp update -g $RG -n $APP --image $IMAGE
   ```
   This creates a new revision. If the app was first created with `az containerapp up --source .`, running the same
   command again from the repository folder also builds and deploys.
4. Wait 1–2 minutes and run the checks in section 5.

## 5. Check that it works

```powershell
$URL = "https://YOUR_APP_HOST"   # App Service: https://$APP.azurewebsites.net ; Container App: the Application Url on Overview
Invoke-RestMethod "$URL/api/v1/health?deep=true" | ConvertTo-Json -Depth 6
```
Expected:
- `status: "ok"`;
- `config.earthdata_token_configured: true` — the secret reaches the container;
- `config.state_db: "ok"`;
- `sources.sources.giovanni.status`, `opendap.status`, `eonet.status` all `"ok"`, meaning the NASA services accept the token from Azure;
- `europe_cube.status` is `"ready"` only if the cube is on a storage mount (section 6); otherwise `"not_ready"` is normal.

Then check the prepared data and the interface:
```powershell
(Invoke-RestMethod "$URL/api/v1/globe/europe").layers | Format-Table variable_id, status, served_from, @{n='trend';e={$_.trend.status}}
(Invoke-RestMethod "$URL/api/v1/maps/europe").maps | Format-Table variable_id, status
(Invoke-RestMethod "$URL/api/v1/known-events").events.Count     # 10
Invoke-WebRequest "$URL/" -UseBasicParsing | Select-Object StatusCode   # 200: the interface is in the image
```
All 7 globe layers (frames and trend) and all 7 maps must be `ok`. Without a storage mount, `served_from` is `prepared_copy_in_image`.

Finally, one real analysis. This calls NASA Giovanni, so it can take 10–60 s:
```powershell
$body = '{"variable_id":"t2m","location":{"type":"point","lat":40.71,"lon":-74.01}}'
$r = Invoke-RestMethod "$URL/api/v1/analyses" -Method Post -ContentType "application/json" -Body $body
$r.status; $r.job_id   # "ok" with a result, or a job id to follow at $URL/api/v1/jobs/<job_id>
```

## 6. Keep one instance running (background jobs) and optional persistent data

Areas outside Europe, MODIS points and investigations run as **background jobs inside the one running instance**. Jobs,
progress and the cache live in that instance (SQLite in `/tmp`). So:
- **Exactly one instance:** not zero, so jobs and the first click are not cut off by a cold start; not more than one, so
  every request sees the same jobs.
- **A restart or redeploy loses running jobs**, because `/tmp` is not kept. A job id from before the restart then answers
  `404 unknown_job`; run the request again. This is expected. Jobs interrupted while the process keeps its disk are requeued on start.

**A. App Service** needs the **Basic (B1) plan or higher**; Always On is not available on Free (F1).
```powershell
az webapp config set -g $RG -n $APP --always-on true
```
Optional: Portal → the Web App → Monitoring → **Health check** → path `/api/v1/health`.
Keep the plan's instance count at 1: Portal → App Service plan → **Scale out** → Manual, 1 instance.

**B. Container Apps:**
```powershell
az containerapp update -g $RG -n $APP --min-replicas 1 --max-replicas 1
```
With `--min-replicas 1` one replica is always billed. Lower it to `0` after judging if cost matters; the first visitor then waits for a cold start.

### Optional: the Europe data cube on persistent storage
Without the cube everything works:
- maps and globe come from the copies in the image;
- points in Europe, investigations and areas use NASA Giovanni and Harmony live.

It is only slower: an investigation makes about 15 live NASA requests. With the cube, Europe answers are instant.
The cube is about **570 MB** (`data/runtime/cube/europe/` on the computer that built it).
1. Create an **Azure Files** share (Storage account → File shares), for example `trend-data`, and upload the folder
   `cube/europe/…` to it so the share contains `cube/europe/<variable>/{data.npy,meta.json,status.json}`. Use the Portal
   upload, Azure Storage Explorer or AzCopy.
2. Mount the share at `/mnt/data`.
   - **A. App Service:** Settings → Configuration → **Path mappings** → New Azure Storage Mount (type Azure Files, mount path `/mnt/data`).
   - **B. Container Apps:** first add the share to the environment
     (`az containerapp env storage set ... --azure-file-share-name trend-data --access-mode ReadWrite`), then add a volume
     with `storageType: AzureFile` and a `volumeMount` at `/mnt/data` to the app's YAML. Apply it with
     `az containerapp update -g $RG -n $APP --yaml app.yaml`. The tutorial is linked below.
3. Set `DATA_DIR=/mnt/data` (section 2) and restart. `health` should now show `europe_cube.status: "ready"`.

To build the cube in Azure instead (1.5–3 hours, needs the token), run
`python -m backend.pipelines.europe_cube --products all --with-maps` once with the same `DATA_DIR`. Use the SSH console of the
Web App or a Container Apps job with the same image. `--with-maps` also rebuilds the trend maps and the globe frames.

## 7. Logs

```powershell
az webapp log tail -g $RG -n $APP                       # A (enable "App Service logs" → File System first)
az containerapp logs show -g $RG -n $APP --follow       # B
```
The application never writes the token to its logs. Do not paste it anywhere to "test".

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App Service: "container didn't respond to HTTP pings on port …" | `WEBSITES_PORT` missing | Set `WEBSITES_PORT=8080`, restart |
| `earthdata_token_configured: false` | Secret not set, or not referenced by the variable | Section 3; for Container Apps check `secretref:` |
| `giovanni.status` not `ok` while the token is set | Token expired or mistyped | New token from <https://urs.earthdata.nasa.gov/> → section 3 |
| Globe or maps `not_ready` | Image built without `data/prepared/…` | Pull, check section 1, rebuild |
| `/` returns the "Backend is running" page | Frontend build stage failed or was skipped | Read the `az acr build` output for the Node stage |
| Jobs "disappear" | Instance restarted or scaled to 0 / >1 | Section 6: exactly one instance, Always On / min replicas 1 |

## References (Microsoft Learn)
- Custom containers on App Service, `WEBSITES_PORT`, storage: <https://learn.microsoft.com/azure/app-service/configure-custom-container>
- Continuous deployment of custom containers: <https://learn.microsoft.com/azure/app-service/deploy-ci-cd-custom-container>
- `az webapp config container`: <https://learn.microsoft.com/cli/azure/webapp/config/container>
- Key Vault references in App Service: <https://learn.microsoft.com/azure/app-service/app-service-key-vault-references>
- App Service pricing (Always On from Basic): <https://azure.microsoft.com/pricing/details/app-service/linux/>
- Container Apps environment variables and secrets: <https://learn.microsoft.com/azure/container-apps/environment-variables>
- Container Apps scaling (min / max replicas): <https://learn.microsoft.com/azure/container-apps/scale-app>
- Container Apps Azure Files mount: <https://learn.microsoft.com/azure/container-apps/storage-mounts-azure-files>
- ACR Tasks quick build: <https://learn.microsoft.com/azure/container-registry/container-registry-tutorial-quick-task>
