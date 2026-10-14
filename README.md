# DevOps learning API

A tiny Node.js API for the Group B DevOps assignment. The application is deliberately small so we can focus on building, deploying, and monitoring it.

## Run locally

Use Node.js 24 for development, matching CI and the container runtime. Supported versions are Node.js 22, 24, and 26 or newer. The HTTP server uses built-in modules; `@prometheus-io/client` provides metrics. Install dependencies from the lockfile:

```sh
npm ci
```

```sh
npm start
```

In another terminal:

```sh
curl http://localhost:3000/
# {"message":"Hello from the DevOps app!"}

curl http://localhost:3000/health
# {"status":"ok"}

curl http://localhost:3000/metrics
# Prometheus text exposition: HTTP and Node.js runtime metrics
```

Stop the app with Ctrl+C.

## Configuration

The app reads these environment variables when it starts:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port |
| `GREETING` | `Hello from the DevOps app!` | Message returned by `GET /` |

```sh
GREETING="Hello Group B!" PORT=3001 npm start
curl http://localhost:3001/
```

Run the curl command in another terminal. The greeting is kept outside the code so a Kubernetes ConfigMap can supply it in a later step. The server listens on `0.0.0.0` so it can receive requests when running inside a container.

## Tests

```sh
npm test
```

Tests make real HTTP requests to temporary local servers. They check greetings, health, unknown routes, unsupported methods, metric counts and histograms, bounded route labels, and registry isolation. GitHub Actions runs the same command.

## Lint

```sh
npm run lint
```

ESLint checks the application, tests, and its own configuration with the recommended JavaScript rules and Node.js globals. It catches issues such as unused variables and undefined names. Warnings also cause this command to fail.

ESLint and its configuration packages are development dependencies. A Docker build stage installs production dependencies with `npm ci --omit=dev`; the distroless runtime receives those modules and the application, without the development tools.

## GitHub Actions

The workflow in `.github/workflows/ci.yml` runs on every push and pull request. It can also be started manually from the repository's **Actions** tab once the workflow is on the default branch.

The workflow has three jobs:

| Job | What it does | Prerequisites |
| --- | --- | --- |
| `lint` / **Lint API** | Runs `npm run lint` | None |
| `test` / **Test API** | Runs `npm test` | Lint must pass |
| `build` / **Build, scan, and publish image** | Builds and scans AMD64 and ARM64 images; publishes the scanned images to GHCR on pushes to `master` | Lint, tests, and both image scans must pass |

The jobs run in sequence: **Lint API → Test API → Build, scan, and publish image**. The test job uses `needs: lint`, and the build job uses `needs: test`. If lint fails, tests and build are skipped; if tests fail, build is skipped. Each check runs on its own GitHub-hosted Ubuntu runner, checks out the repository, sets up Node.js 24, and installs dependencies with `npm ci`.

To see a real workflow run, commit and push these files to a GitHub repository, open its **Actions** tab, and select **App CI**. Open **Lint API** or **Test API** to see the corresponding output. Save a capture of that run for the assignment.

## Image vulnerability gate

The build job loads an AMD64 image and an ARM64 image into the runner's Docker engine, then scans both with Trivy. The policy blocks publishing for **HIGH or CRITICAL vulnerabilities with an available fix**, in OS packages or application libraries. Lower severities and vulnerabilities without fixes do not block this learning pipeline. This vulnerability check does not scan for secrets, generate an SBOM, or prove that an image has no security issues.

If either scan fails, GHCR login and publication are skipped. Scanner errors also block publication. Available JSON reports are uploaded even when a scan fails: open the workflow run's **Artifacts** section and download `trivy-reports-<commit-sha>`. Reports are retained for 14 days; copy the relevant reports into the solo evidence folder when documenting a run.

When both scans pass, the workflow pushes the exact locally scanned images as `<commit-sha>-amd64` and `<commit-sha>-arm64`, then creates the common `<commit-sha>` multi-platform index from them. It does not rebuild the image after scanning. Normal pulls can continue to use the common tag and automatically select the matching architecture.

The Trivy and report-upload actions are pinned to full commit SHAs, and the scanner version is fixed at `v0.75.0`. Scan results can change as the vulnerability database is updated. Automatic BuildKit attestations depend on the exporter and image store; this export/load/push flow does not rely on their preservation. Signed provenance and SBOMs can be added and verified separately.

## Files

- `src/server.js`: routes, configuration, and server startup.
- `test/server.test.js`: HTTP tests using Node's built-in test runner.
- `package.json`: commands for running and testing the app.
- `eslint.config.js`: recommended JavaScript lint rules for Node.js.
- `.github/workflows/ci.yml`: lint, tests, image builds, vulnerability scans, and GHCR publishing.

## Prometheus and Grafana

The app exposes `GET /metrics`. Prometheus discovers and scrapes each application Pod every 15 seconds. Grafana loads its Prometheus datasource and the **DevOps API Overview** dashboard from versioned files.

- `src/metrics.js`: request counter, duration histogram, and Node.js runtime metrics.
- `k8s/monitoring/`: Prometheus, scoped discovery RBAC, Grafana, dashboard, and scrape alerts.
- [Pillar 3 setup and design](docs/solo/pillar-3.md): architecture, deployment, PromQL, traffic generation, troubleshooting, and demo storage limits.

Build an app image containing `/metrics` before deploying monitoring: the historical image currently pinned in `k8s/app/deployment.yaml` does not contain this change. Follow the linked walkthrough for either a local kind image or a newly published CI image.
