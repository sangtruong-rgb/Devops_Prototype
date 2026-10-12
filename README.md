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

Its `test` job runs on a GitHub-hosted Ubuntu runner and performs five steps:

1. Check out the repository so the runner has our code.
2. Set up Node.js 24.
3. Install development dependencies with `npm ci`.
4. Run `npm run lint`.
5. Run `npm test`.

Lint or test failures make the job fail. The build job requires this job to succeed before it builds AMD64 and ARM64 images and publishes them to GHCR on pushes to `master`.

To see a real workflow run, commit and push these files to a GitHub repository, open its **Actions** tab, and select **App CI**. Open **Lint and test API** to see the lint and test output. Save a capture of that run for the assignment.

## Files

- `src/server.js`: routes, configuration, and server startup.
- `test/server.test.js`: HTTP tests using Node's built-in test runner.
- `package.json`: commands for running and testing the app.
- `eslint.config.js`: recommended JavaScript lint rules for Node.js.
- `.github/workflows/ci.yml`: lint, tests, image builds, and GHCR publishing.

The app, lint and test checks, and multi-platform image publishing are implemented. Kubernetes and metrics will be added as we work through those topics.
