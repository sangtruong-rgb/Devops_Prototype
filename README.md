# DevOps learning API

A tiny Node.js API for the Group B DevOps assignment. The application is deliberately small so we can focus on building, deploying, and monitoring it.

## Run locally

The application requires Node.js 22 or newer and uses only built-in modules. Use Node.js 24 for development, matching CI. Install the development tools from the lockfile:

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

Tests make real HTTP requests to temporary local servers. They check the default and configured greetings, health response, unknown routes, and unsupported methods. GitHub Actions runs the same command.

## Lint

```sh
npm run lint
```

ESLint checks the application, tests, and its own configuration with the recommended JavaScript rules and Node.js globals. It catches issues such as unused variables and undefined names. Warnings also cause this command to fail.

ESLint and its configuration packages are development dependencies. The runtime image copies only `package.json` and `src/`, so it does not include the development tools or `node_modules`.

## GitHub Actions

The workflow in `.github/workflows/ci.yml` runs on every push and pull request. It can also be started manually from the repository's **Actions** tab once the workflow is on the default branch.

The workflow has three jobs:

| Job | What it does | Prerequisites |
| --- | --- | --- |
| `lint` / **Lint API** | Runs `npm run lint` | None |
| `test` / **Test API** | Runs `npm test` | None |
| `build` / **Build, scan, and publish image** | Builds and scans AMD64 and ARM64 images; publishes the scanned images to GHCR on pushes to `master` | Lint, tests, and both image scans must pass |

Lint and tests can run in parallel on separate GitHub-hosted Ubuntu runners, with their own results in the Actions view. Each checks out the repository, sets up Node.js 24, and installs development dependencies with `npm ci` before running its check. A failure in either job blocks the build job through `needs: [lint, test]`.

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

The app, lint and test checks, image vulnerability gate, and multi-platform image publishing are implemented. Kubernetes and metrics will be added as we work through those topics.
