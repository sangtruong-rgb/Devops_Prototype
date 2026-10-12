# Pillar 1 — CI/CD and Container Security: Solo Implementation

This document records Sang Truong's solo implementation for Pillar 1: a small API, a container image, GitHub Actions tests and builds, publishing to GHCR, and running the published image locally. It includes the code, commands, results, and problems encountered so the work can be explained at CP1 and repeated later.

The implementation is recorded in [Devops_Prototype](https://github.com/sangtruong-rgb/Devops_Prototype). The current personal repository uses `master`; the sprint calls the eventual shared baseline `main`. The team still needs to choose and integrate its shared approach at the checkpoint. The evidence linked here belongs to the solo system, while graded `/captures` will come from the shared system.

Commands below are replay instructions drawn from the work in this session. Git history and saved logs verify the implementation milestones; setup commands without a saved terminal transcript are identified as equivalent instructions rather than an exact shell history. Source-code blocks record the implementation stages. Section 15 documents the lint addition made on 12 October after the original image captures; those captures refer to the earlier workflow.

## 1. The result and the path we built

```text
Edit code → commit → push to GitHub
                         ↓
                    Test API job
                         ↓ tests pass
                 Build and publish job
                         ↓
          GHCR image index: AMD64 + ARM64
                         ↓ docker pull
              Container on my laptop
                         ↓ laptop port 3001 → container port 3000
                    HTTP response
```

The pipeline packages and publishes the app. Running a container on my laptop was a separate manual operation. Kubernetes deployment belongs to Pillar 2.

| Item | Recorded value |
| --- | --- |
| Repository | `sangtruong-rgb/Devops_Prototype` |
| Personal repository branch | `master` |
| Image repository | `ghcr.io/sangtruong-rgb/devops-app` |
| Tested multi-architecture commit/tag | `afc52c1f019813ae20e18a1a78bb880a2ac2f372` |
| Image index digest | `sha256:b58a6c878aa6b6a9e64dcb2d285913aa64075870c36fd76faca8224f6597d62e` |
| Captured CI run | [38155467188](https://github.com/sangtruong-rgb/Devops_Prototype/actions/runs/38155467188) |
| Local Docker engine | `linux/x86_64` |
| Published application platforms | `linux/amd64`, `linux/arm64` |
| Local container name | `devops-multiarch-check` |

## 2. Step 1 — Build the smallest useful application

We chose Node.js and its built-in HTTP server. There is no database, frontend, or third-party runtime dependency. Keeping the app small makes the deployment pipeline easier to understand.

### Original package configuration

File: [package.json](../../package.json)

```json
{
  "name": "devops-learning-api",
  "version": "1.0.0",
  "private": true,
  "description": "A tiny API for learning DevOps and observability",
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  }
}
```

`npm start` runs the server. `npm test` uses Node's built-in test runner. `type: module` enables the `import` syntax. The app supports Node.js 22 or newer, while our CI and container use Node.js 24. The original lockfile had no third-party dependencies. Section 15 adds development dependencies for linting; the app itself still has no third-party runtime dependencies.

### Application code

File: [src/server.js](../../src/server.js)

```javascript
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export function createServer({ greeting = 'Hello from the DevOps app!' } = {}) {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    let status = 200;
    let body;

    if (pathname !== '/' && pathname !== '/health') {
      status = 404;
      body = { error: 'Not found' };
    } else if (request.method !== 'GET') {
      status = 405;
      response.setHeader('Allow', 'GET');
      body = { error: 'Method not allowed' };
    } else if (pathname === '/health') {
      body = { status: 'ok' };
    } else {
      body = { message: greeting };
    }

    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  });
}

// Importing this file in a test creates no listener. npm start runs this block.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const server = createServer({ greeting: process.env.GREETING });
  server.listen(port, '0.0.0.0', () => {
    console.log(`API listening on port ${port}`);
  });

  // Let requests finish when the process is stopped by a terminal or container.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close();
    });
  }
}
```

The application exposes the following behavior:

| Request | Response |
| --- | --- |
| `GET /` | HTTP 200 with a JSON greeting |
| `GET /health` | HTTP 200 with `{"status":"ok"}` |
| Unknown route | HTTP 404 |
| Unsupported method on a known route | HTTP 405 and `Allow: GET` |

`PORT` controls the listening port and defaults to 3000. `GREETING` controls the message without changing the code. Binding to `0.0.0.0` makes the server reachable through the container's network interface. The health endpoint reports that this small server can handle a request; there are no external dependencies to check.

The startup guard lets tests import `createServer` without starting the normal listener. The signal handlers ask the server to close when the terminal or container sends SIGINT or SIGTERM.

### Commands for running the app directly

From the project directory:

```sh
cd /Users/sang.truong/Documents/devops
npm start
```

In another terminal:

```sh
curl http://localhost:3000/
curl http://localhost:3000/health
```

These commands run Node.js directly on the laptop. Container execution is introduced in Step 4 below.

## 3. Step 2 — Add HTTP tests and the first CI workflow

### Test code

File: [test/server.test.js](../../test/server.test.js)

```javascript
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createServer } from '../src/server.js';

async function startServer(t, options) {
  const server = createServer(options);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('GET / returns a JSON greeting', async (t) => {
  const url = await startServer(t);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { message: 'Hello from the DevOps app!' });
});

test('the greeting can be configured without changing app code', async (t) => {
  const url = await startServer(t, { greeting: 'Hello Group B!' });
  const response = await fetch(url);
  assert.deepEqual(await response.json(), { message: 'Hello Group B!' });
});

test('GET /health reports a healthy app', async (t) => {
  const url = await startServer(t);
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('unknown routes return 404', async (t) => {
  const url = await startServer(t);
  const response = await fetch(`${url}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});

test('POST / is rejected with the allowed method', async (t) => {
  const url = await startServer(t);
  const response = await fetch(url, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.deepEqual(await response.json(), { error: 'Method not allowed' });
});
```

The tests start servers on temporary local ports and make real HTTP requests. They cover the default greeting, a configured greeting, health, unknown routes, and an unsupported method. Run them with:

```sh
npm test
```

The captured GitHub run reports five tests, five passes, and zero failures. The original local test attempt was blocked by the coding agent's sandbox from opening a listening port; rerunning outside that sandbox passed. That was an execution-environment restriction rather than an application failure.

### First workflow: tests only

We added `.github/workflows/ci.yml`. This was the initial version recorded in commit `777027c`:

```yaml
name: App CI

# Run automatically for pushes and pull requests, or manually from GitHub.
on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  test:
    name: Test API
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Check out the repository
        uses: actions/checkout@v7

      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: '24'
          package-manager-cache: false

      # This app has no external dependencies, so no install step is needed.
      - name: Run HTTP tests
        run: npm test
```

The workflow runs for pushes and pull requests and can be started manually. GitHub looks for workflow YAML in `.github/workflows/`. Each job runs on a runner, and its steps execute in sequence. The first workflow checked out the code, selected Node.js 24, and ran `npm test`. [GitHub workflow concepts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows)

No `npm install` or `npm ci` step was necessary because the app has no external dependencies. No dependency cache was needed either.

### GitHub repository setup

The project was initially an empty local folder without Git metadata. The resulting public repository has this remote:

```text
origin  https://github.com/sangtruong-rgb/Devops_Prototype.git
```

For someone replaying the initial setup in a new, uninitialized copy, these are equivalent commands. Use your own name and GitHub-associated email. The actual initial shell commands were not captured.

```sh
git init -b master
git config user.name "Your Name"
git config user.email "your-email@example.com"
git add .
git commit -m "Add toy API and GitHub Actions test workflow"
gh auth login
gh auth setup-git
gh repo create Devops_Prototype --public --source=. --remote=origin --push
```

The replay command creates a new repository, so it should be used only when that repository does not already exist. Our actual initial commit message was `feat: First update`, and our repository uses `master`. An earlier proposed `pillar-1-solo` branch was not used in the recorded Git history.

The initial successful CI run is [37917039292](https://github.com/sangtruong-rgb/Devops_Prototype/actions/runs/37917039292). The Actions tab displays the workflow, its jobs, and each step's logs. Manual runs require the workflow file on the default branch. [Viewing workflow runs](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history), [manual workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

## 4. Step 3 — Write the container definition

File: [dockerfile](../../dockerfile)

```dockerfile
FROM gcr.io/distroless/nodejs24-debian13:nonroot

WORKDIR /app

COPY package.json ./
COPY src/ ./src/

ENV PORT=3000

EXPOSE 3000

CMD ["src/server.js"]
```

The filename is lowercase `dockerfile`, so local build commands explicitly select it using `-f dockerfile`. The final workflow also selects `./dockerfile`.

| Instruction | What it does in this app |
| --- | --- |
| `FROM` | Supplies Node.js 24 and its required system libraries |
| `:nonroot` | Selects the base image's non-root user configuration |
| `WORKDIR /app` | Sets the container's working directory |
| `COPY package.json ./` | Copies the module configuration |
| `COPY src/ ./src/` | Copies the server code |
| `ENV PORT=3000` | Sets a default that can be overridden at runtime |
| `EXPOSE 3000` | Documents the application's port |
| `CMD ["src/server.js"]` | Supplies the script to the base image's Node.js entrypoint |

The base is distroless: it contains the runtime and required libraries, without a shell or package manager. Its Node.js entrypoint is already configured, which is why `CMD` contains the script path rather than `npm start`. This reduces unnecessary runtime components, but makes shell-based debugging unavailable. A minimal image still needs security updates. [Distroless documentation](https://github.com/GoogleContainerTools/distroless)

There is no build or dependency-installation stage because this application runs its source directly and uses only Node's built-in modules.

### Git exclusions and build context

File: [.gitignore](../../.gitignore)

```text
node_modules/
.env
.env.*
!.env.example
coverage/
*.log
.DS_Store
```

The Git exclusions keep local environment files, logs, dependencies, and generated files out of normal commits. The Dockerfile copies only `package.json` and `src/`; no application secrets are intentionally added to it.

There is currently no `.dockerignore`. `.gitignore` does not control Docker's build context. Adding a `.dockerignore` would be a useful improvement to exclude unnecessary or sensitive files from the context sent to the builder. Secrets must also be kept out of any files we deliberately copy. [Docker build context and exclusions](https://docs.docker.com/build/concepts/context/)

## 5. Step 4 — Build and run the image locally

Docker Desktop provides the Docker engine on the Mac. The commands used for the first local image were:

```sh
docker build -f dockerfile -t devops-app:v1 .
docker image ls devops-app
```

`-f` selects the Dockerfile, `-t` sets an image name and tag, and the final `.` selects the current directory as the build context. Building packages the app; it does not start the server.

We then ran the image:

```sh
docker run --rm --name devops-app -p 3000:3000 devops-app:v1
```

`docker run` creates and starts a container from the image. `--rm` removes the container when it stops, while the image remains available. The server printed:

```text
API listening on port 3000
```

In a second terminal, real requests returned the expected results:

```sh
curl http://localhost:3000/
curl http://localhost:3000/health
```

```json
{"message":"Hello from the DevOps app!"}
{"status":"ok"}
```

If the laptop's port 3000 is already occupied, use `-p 3001:3000` and make requests to laptop port 3001 instead.

## 6. Step 5 — Make CI build the image after tests pass

We extended the initial workflow with this second job:

```yaml
  build:
    name: Build container image
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Check out the repository
        uses: actions/checkout@v7

      - name: Build image
        run: docker build -f dockerfile -t devops-app:ci .
```

`build` is a sibling of `test` under `jobs`. `needs: test` makes the build wait for successful tests. If the tests fail, the dependent build is skipped. Checkout is repeated because the second job gets its own runner. [GitHub job dependencies](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs)

The change was committed and pushed:

```sh
git add dockerfile .github/workflows/ci.yml
git commit -m "Build container image after passing tests"
git push
```

The build passed in [run 38146701866](https://github.com/sangtruong-rgb/Devops_Prototype/actions/runs/38146701866). At this stage the image existed on the temporary runner, so the next change was to upload it to a registry.

## 7. Step 6 — Authenticate and publish to GHCR

We chose `ghcr.io/sangtruong-rgb/devops-app` as the image repository. The first publishing version added the following configuration to the build job:

```yaml
    permissions:
      contents: read
      packages: write

    env:
      IMAGE: ghcr.io/sangtruong-rgb/devops-app
```

It replaced the local-only build step with a registry-tagged build and added login and upload steps:

```yaml
      - name: Build image
        run: |
          docker build -f dockerfile \
            --label "org.opencontainers.image.source=https://github.com/$GITHUB_REPOSITORY" \
            -t "$IMAGE:$GITHUB_SHA" .

      - name: Log in to GHCR
        if: github.event_name == 'push' && github.ref == 'refs/heads/master'
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Push image
        if: github.event_name == 'push' && github.ref == 'refs/heads/master'
        run: docker push "$IMAGE:$GITHUB_SHA"
```

GitHub supplies the workflow token automatically. `packages: write` grants the build job permission to upload packages. The token is used for login, without being put in the Dockerfile. GHCR supports publishing from GitHub Actions with `GITHUB_TOKEN`. [GHCR authentication and publishing](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

The source label connects the image to its repository. `GITHUB_SHA` ties the tag to the source commit. A commit-based tag is useful for traceability, but a registry tag can be reassigned; a digest identifies the actual image content.

The `if` conditions publish only for pushes to `master`. Pull requests still test and build. A manual workflow run does not publish with this condition. If the team later changes its publishing branch to `main`, it must update these conditions.

```sh
git add .github/workflows/ci.yml
git commit -m "Publish tested container image to GHCR"
git push
```

The successful first publishing run was [38147442932](https://github.com/sangtruong-rgb/Devops_Prototype/actions/runs/38147442932), for commit `08bec075bae5d5a0a85bffe8986ff0c01aa8be54`.

## 8. Step 7 — Pull and run the CI-built image

The instructions for enabling anonymous downloads were: GitHub profile → Packages → `devops-app` → Package settings → Change visibility → Public. Package visibility is separate from repository visibility; newly published personal packages default to private. The browser visibility change itself was not saved in the evidence files. [Package visibility documentation](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)

We successfully pulled the first published image:

```sh
docker pull ghcr.io/sangtruong-rgb/devops-app:08bec075bae5d5a0a85bffe8986ff0c01aa8be54
```

The terminal transcript recorded:

```text
Digest: sha256:f9b4f4eeb4a11172b1faf551afd1c08384c8a66e9c318e89c1dfc415c4e6eecc
Status: Downloaded newer image for ghcr.io/sangtruong-rgb/devops-app:08bec075bae5d5a0a85bffe8986ff0c01aa8be54
```

Then we ran that image with a different greeting:

```sh
docker run --rm --name devops-registry-check -p 3001:3000 -e 'GREETING=Hello from GHCR!' ghcr.io/sangtruong-rgb/devops-app:08bec075bae5d5a0a85bffe8986ff0c01aa8be54
```

In another terminal:

```sh
curl http://localhost:3001/
curl http://localhost:3001/health
```

The real responses were:

```json
{"message":"Hello from GHCR!"}
{"status":"ok"}
```

This was important because it exercised the image built by GitHub, rather than just the earlier local image. `-e` supplies runtime configuration without rebuilding it.

### Why the server says 3000 while curl uses 3001

`-p 3001:3000` means laptop port 3001 forwards to container port 3000:

```text
curl localhost:3001 → Docker port forwarding → app inside container on port 3000
```

The server's startup message describes its internal listener. `EXPOSE 3000` alone does not publish that port on the laptop; `docker run -p` provides the mapping.

## 9. Step 8 — Check CPU architecture and publish both versions

We inspected the local engine and the first downloaded image:

```sh
docker info --format '{{.OSType}}/{{.Architecture}}'

docker image inspect \
  ghcr.io/sangtruong-rgb/devops-app:08bec075bae5d5a0a85bffe8986ff0c01aa8be54 \
  --format '{{.Os}}/{{.Architecture}}'
```

The outputs were:

```text
linux/x86_64
linux/amd64
```

`x86_64` and `amd64` describe the same architecture. The first image therefore matched this laptop. Although the assignment anticipates Apple M1 laptops, the Docker engine used in this solo session reported AMD64. Apple silicon teammates need ARM64 support or emulation.

We updated the build job to set up QEMU and Buildx, then used `docker/build-push-action` to build `linux/amd64` and `linux/arm64` and publish one index containing both. QEMU supports execution of foreign-architecture programs when needed during a build. This particular Dockerfile has no `RUN` instruction, so it does not need to execute application code for either target while building. Buildx manages the platform-specific builds and exports the index. [Docker multi-platform builds in GitHub Actions](https://docs.docker.com/build/ci/github-actions/multi-platform/)

### Complete workflow before the lint addition

File: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)

```yaml
name: App CI

# Run automatically for pushes and pull requests, or manually from GitHub.
on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  test:
    name: Test API
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Check out the repository
        uses: actions/checkout@v7

      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: '24'
          package-manager-cache: false

      # This app has no external dependencies, so no install step is needed.
      - name: Run HTTP tests
        run: npm test

  build:
    name: Build and publish image
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 10

    permissions:
      contents: read
      packages: write

    env:
      IMAGE: ghcr.io/sangtruong-rgb/devops-app

    steps:
      - name: Check out the repository
        uses: actions/checkout@v7

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to GHCR
        if: github.event_name == 'push' && github.ref == 'refs/heads/master'
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and publish both architectures
        uses: docker/build-push-action@v7
        with:
          context: .
          file: ./dockerfile
          platforms: linux/amd64,linux/arm64
          push: ${{ github.event_name == 'push' && github.ref == 'refs/heads/master' }}
          tags: ${{ env.IMAGE }}:${{ github.sha }}
          labels: |
            org.opencontainers.image.source=https://github.com/${{ github.repository }}
```

`context: .` uses the checked-out working directory, and `file: ./dockerfile` selects our lowercase file. The `push` expression preserves the publishing restriction. This action replaces the separate `docker build` and `docker push` commands from Step 6.

We committed and pushed:

```sh
git add .github/workflows/ci.yml
git commit -m "Publish AMD64 and ARM64 container images"
git push
```

Run [38155467188](https://github.com/sangtruong-rgb/Devops_Prototype/actions/runs/38155467188) passed for commit `afc52c1f019813ae20e18a1a78bb880a2ac2f372`. The saved CI log records five passing tests and the successful upload of the image index.

### Inspect the published index

```sh
docker buildx imagetools inspect \
  ghcr.io/sangtruong-rgb/devops-app:afc52c1f019813ae20e18a1a78bb880a2ac2f372
```

The saved [platform inspection](../evidence/solo/pillar-1/platforms.txt) shows `linux/amd64` and `linux/arm64`, plus two entries marked `attestation-manifest` with `unknown/unknown` platforms. Those extra entries are build metadata rather than runnable application platforms. BuildKit can attach attestations to an image index. Their presence alone does not establish that we generated an SBOM or configured GitHub-signed artifact attestations. [Docker image inspection](https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/), [Docker build attestations](https://docs.docker.com/build/metadata/attestations/)

`docker image inspect` examines a local image, while `docker buildx imagetools inspect` examines the registry index. A laptop pulling the tag selects the matching platform-specific image.

### What about Windows?

Windows teammates can run the Linux image with Docker Desktop in Linux-container mode, for example using its WSL 2 backend. They do not need a native Windows image for this app. Native Windows containers would require a different base image and build setup. Windows execution was discussed, but was not demonstrated in these captures. [Docker Desktop WSL 2 documentation](https://docs.docker.com/desktop/features/wsl/)

## 10. Step 9 — Validate the new published image locally

We stopped the old foreground container with Ctrl+C. Because it used `--rm`, stopping it removed the container and freed the laptop port.

In the same terminal, we selected and pulled the new image:

```sh
APP_IMAGE=ghcr.io/sangtruong-rgb/devops-app:afc52c1f019813ae20e18a1a78bb880a2ac2f372
docker pull "$APP_IMAGE"
```

The terminal recorded the index digest:

```text
Digest: sha256:b58a6c878aa6b6a9e64dcb2d285913aa64075870c36fd76faca8224f6597d62e
```

We then ran it:

```sh
docker run --rm \
  --name devops-multiarch-check \
  -p 3001:3000 \
  -e 'GREETING=Hello from the multi-architecture image!' \
  "$APP_IMAGE"
```

The variable must be set in the terminal where this command is executed. The app again printed `API listening on port 3000`: packaging a second architecture does not change the server's startup behavior.

In another terminal, we checked the HTTP status and body:

```sh
curl -i http://localhost:3001/
curl -i http://localhost:3001/health
```

Both saved responses have HTTP 200. Their bodies are:

```json
{"message":"Hello from the multi-architecture image!"}
{"status":"ok"}
```

We also checked the selected container:

```sh
docker inspect devops-multiarch-check \
  --format 'Running={{.State.Running}} Image={{.Config.Image}} User={{.Config.User}}'
```

The saved result is:

```text
Running=true Image=ghcr.io/sangtruong-rgb/devops-app:afc52c1f019813ae20e18a1a78bb880a2ac2f372 User=65532
```

This confirms the container is running the intended tag and is configured for the non-root UID 65532. The HTTP requests confirm useful behavior beyond the startup log. This is a native AMD64 runtime test; the ARM64 variant was built and published but has not yet been run on an ARM machine in this evidence set.

## 11. Step 10 — Fix the problems encountered

### Docker command not found

The pull command initially failed with:

```text
zsh: command not found: docker
```

Inspection found Docker Desktop at `/Applications/Docker.app` and a Docker CLI link in `~/.docker/bin`, but that directory was absent from the terminal's PATH. The executable itself worked.

The commands supplied for the fix were:

```sh
export PATH="$HOME/.docker/bin:$PATH"
docker version
```

The first command makes Docker discoverable in the current terminal. To keep that setting in future zsh terminals, the proposed persistent command was:

```sh
echo 'export PATH="$HOME/.docker/bin:$PATH"' >> ~/.zshrc
```

Only add that line if an equivalent PATH setting is not already present. If Docker's client works but it cannot connect to the server, start Docker Desktop and wait for its engine. A later successful pull confirms the command-availability problem was resolved; the exact shell startup edit was not captured. [Docker Desktop Mac setup](https://docs.docker.com/desktop/setup/install/mac-install/)

### The terminal displayed `dquote>`

An attempted multiline `docker run` left zsh waiting for a closing double quote. The command had not yet executed. The fix was to press Ctrl+C, then paste a single-line command using single quotes around the greeting:

```sh
docker run --rm --name devops-registry-check -p 3001:3000 -e 'GREETING=Hello from GHCR!' ghcr.io/sangtruong-rgb/devops-app:08bec075bae5d5a0a85bffe8986ff0c01aa8be54
```

The original unmatched quote was not identifiable from the pasted command alone, so this records the observed shell state and working retry rather than claiming a specific typing mistake.

### The two response bodies appeared joined together

The server uses `JSON.stringify` without adding a trailing newline, so two successive curl calls display adjacent JSON bodies. The `%` marker visible in the terminal indicates the previous output had no newline; it is not part of the HTTP response. Capturing `curl -i` preserved both the HTTP status and body for each endpoint in separate files.

## 12. Step 11 — Save and commit the real evidence

We created a solo evidence directory:

```sh
mkdir -p docs/evidence/solo/pillar-1
```

With the container still running, we saved the HTTP responses and container configuration:

```sh
curl -i http://localhost:3001/ | tee docs/evidence/solo/pillar-1/greeting.txt

curl -i http://localhost:3001/health | tee docs/evidence/solo/pillar-1/health.txt

docker inspect devops-multiarch-check \
  --format 'Running={{.State.Running}} Image={{.Config.Image}} User={{.Config.User}}' \
  | tee docs/evidence/solo/pillar-1/container.txt
```

We saved the published platforms and downloaded the GitHub run log:

```sh
docker buildx imagetools inspect \
  ghcr.io/sangtruong-rgb/devops-app:afc52c1f019813ae20e18a1a78bb880a2ac2f372 \
  | tee docs/evidence/solo/pillar-1/platforms.txt

gh run view 38155467188 --log > docs/evidence/solo/pillar-1/ci-run.txt
```

`tee` displays and saves output. `>` redirects output to a file. These are actual command captures rather than manually written expected results.

The evidence was committed:

```sh
git status --short
git add docs/evidence/solo/pillar-1
git commit -m "Record solo Pillar 1 pipeline evidence"
git push
```

### Evidence index

| Capture | What it establishes |
| --- | --- |
| [CI log](../evidence/solo/pillar-1/ci-run.txt) | Five passing tests and the image index uploaded to GHCR |
| [Published platforms](../evidence/solo/pillar-1/platforms.txt) | AMD64 and ARM64 images under the tested tag, with the index digest |
| [Container details](../evidence/solo/pillar-1/container.txt) | Running state, selected image tag, and configured user |
| [Greeting response](../evidence/solo/pillar-1/greeting.txt) | HTTP 200 and the runtime-configured greeting |
| [Health response](../evidence/solo/pillar-1/health.txt) | HTTP 200 and `{"status":"ok"}` |

The HTTP captures contain timestamps in UTC, as HTTP Date headers normally do. The CI log is also timestamped in UTC. The saved CI run started on 11 October 2026 at about 16:26 UTC, which is 23:26 on 11 October in Vietnam. The HTTP checks around 16:46 UTC correspond to 23:46 in Vietnam.

The evidence deliberately refers to the tested application commit `afc52c1`. Committing evidence caused a later workflow run and a new commit-based image tag; it does not invalidate the captures of the earlier tested image.

### Actual incremental Git history

| Commit | Message | Change |
| --- | --- | --- |
| `777027c` | `feat: First update` | App, tests, package files, and initial test workflow |
| `11aceb4` | `Build container image after passing tests` | Dockerfile and dependent image build job |
| `08bec07` | `Publish tested container image to GHCR` | Registry tagging, authentication, and upload |
| `afc52c1` | `Publish AMD64 and ARM64 container images` | Multi-platform build and publishing |
| `31a211d` | `Record solo Pillar 1 pipeline evidence` | Saved CI and runtime captures |

## 13. Security decisions and verification limits

| Area | Current implementation or verification |
| --- | --- |
| Minimal runtime | Distroless Node.js 24 base, without a shell or package manager |
| Non-root configuration | Container inspection records user `65532` |
| App secrets | None required; only package configuration and source are copied |
| Registry credentials | Workflow token used by the login step, outside the image |
| Test gate | `needs: test` prevents the build job from running after failed tests |
| Publishing scope | Package-write permission is limited to the build job; upload is restricted to pushes to `master` |
| App health | `/health` tested; no Docker HEALTHCHECK or Kubernetes probes have been added yet |
| Architecture | Both variants built and published; only AMD64 runtime tested locally |
| Build metadata | Attestation manifests recorded; SBOM generation and signed attestation verification not demonstrated |
| Vulnerability scanning | No scan gate added; optional implementation under the assignment |
| Dependency/base pinning | Action major-version tags and a base-image tag are used; they are not pinned to immutable digests or commit SHAs |

This is a learning implementation. It demonstrates the required app/image/CI path and some security practices, rather than establishing a complete production security policy. The assignment's broader research topics, including scanning tools and supply-chain features, still need their own source-grounded treatment in the combined findings.

## 14. CP1 demo and team handoff

At CP1, use the captured run and evidence to explain the path, then demonstrate the image locally if time permits:

1. Open the repository and show the app's two endpoints.
2. Explain the Dockerfile, distroless base, and non-root user.
3. Open the captured Actions run and show the successful tests and publication.
4. Show the GHCR image tag and the saved AMD64/ARM64 inspection.
5. Run the tested tag with a custom greeting and show the two HTTP responses.
6. Explain the PATH and quoting fixes, port mapping, and remaining ARM runtime check.

The revised sprint schedules CP1 for Monday 12 October at 09:00 Vietnam time. Eng A selects the approach for the shared baseline after comparing all three solo builds. Team selection, integration into shared `main`, and the later shared graded captures are not established by this solo evidence.

Before Pillar 2, hand over the chosen image reference, endpoints, port 3000, `PORT` and `GREETING` settings, and these test commands. The current image can be referenced by its tested tag or, for a fixed content identity, by the index digest:

```text
ghcr.io/sangtruong-rgb/devops-app@sha256:b58a6c878aa6b6a9e64dcb2d285913aa64075870c36fd76faca8224f6597d62e
```

### Next command: commit this write-up

This write-up is a newly created local file. The following commands are the next action, rather than part of the completed history above:

```sh
git add docs/solo/pillar-1.md
git commit -m "Document solo Pillar 1 implementation and lessons"
git push
```

## 15. Step 12 — Add linting before the HTTP tests

On 12 October, we added ESLint so CI checks for code mistakes before testing HTTP behavior. Linting catches issues such as undefined names and unused variables; the HTTP tests check the application's responses. The app has no external runtime dependencies, but the development checks now need packages installed with npm.

The packages were installed as development dependencies:

```sh
npm install --save-dev eslint@10.12.0 @eslint/js@10.0.1 globals@17.13.0
```

This updated `package.json` and `package-lock.json`. Future installs, including CI, use `npm ci` to reproduce the locked dependency tree. Development checks use Node.js 24, matching the workflow.

### Lint configuration

File: [eslint.config.js](../../eslint.config.js)

```javascript
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  {
    files: ['src/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },
]);
```

The configuration applies the recommended rules to the application, tests, and lint configuration. Node built-in globals allow names such as `process`, `console`, and `fetch`. [ESLint setup](https://eslint.org/docs/latest/use/getting-started), [language options and globals](https://eslint.org/docs/latest/use/configure/language-options)

The added npm script is:

```json
"lint": "eslint src test eslint.config.js --max-warnings=0"
```

`--max-warnings=0` makes warnings fail the command as well as errors.

### Workflow addition

The job ID remains `test`, with display name `Lint and test API`. After setting up Node.js, it now executes:

```yaml
      - name: Install development dependencies
        run: npm ci

      - name: Lint JavaScript
        run: npm run lint

      - name: Run HTTP tests
        run: npm test
```

The build job already uses `needs: test`. If dependency installation or linting fails, the job fails and the build job is skipped. Successful linting and tests allow image building and publishing to proceed.

The Dockerfile still packages only the app's package configuration and source. It does not copy `node_modules` or ESLint, because linting is performed on the CI runner and the running app uses only built-in modules.

To run the same checks locally:

```sh
npm ci
npm run lint
npm test
```

Local verification passed: a clean `npm ci`, `npm run lint`, and all five HTTP tests. The workflow YAML also parsed successfully. The captured run and HTTP files in the evidence directory predate this addition. A new GitHub run after committing and pushing the lint changes will provide CI evidence for the extended workflow.
