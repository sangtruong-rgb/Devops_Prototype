# DevOps learning API

A tiny Node.js API for the Group B DevOps assignment. The application is deliberately small so we can focus on building, deploying, and monitoring it.

## Run locally

Requires Node.js 22 or newer. There are no external dependencies, so no install step is needed.

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

## GitHub Actions

The workflow in `.github/workflows/ci.yml` runs on every push and pull request. It can also be started manually from the repository's **Actions** tab once the workflow is on the default branch.

Its `test` job runs on a GitHub-hosted Ubuntu runner and performs three steps:

1. Check out the repository so the runner has our code.
2. Set up Node.js 24.
3. Run `npm test`. A failing test makes the job fail.

No dependency installation or caching is needed because this app uses only Node.js built-in modules.

To see a real workflow run, commit and push these files to a GitHub repository, open its **Actions** tab, and select **App CI**. Open **Test API** to see the test output. Save a capture of that run for the assignment.

## Files

- `src/server.js`: routes, configuration, and server startup.
- `test/server.test.js`: HTTP tests using Node's built-in test runner.
- `package.json`: commands for running and testing the app.
- `.github/workflows/ci.yml`: GitHub Actions test workflow.

The app and test workflow are implemented. Container image builds, publishing to a registry, Kubernetes, and metrics will be added as we work through those topics.
