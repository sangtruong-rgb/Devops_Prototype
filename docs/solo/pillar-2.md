# Pillar 2 — Kubernetes Infrastructure and Network: Solo Walkthrough

## Current setup — 13 October 2026

The active cluster is now **`devops-two-nodes`**, using context **`kind-devops-two-nodes`**. The original `devops-solo` cluster was deleted after the application was verified in the new cluster. Sections below this update preserve the original 12 October walkthrough and evidence; use the new context for commands against the current cluster.

The cluster configuration is [kind/two-nodes.yaml](../../kind/two-nodes.yaml):

~~~yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
~~~

Both nodes run as Docker containers on the same laptop. Both are Ready, and both application Pods run on `devops-two-nodes-worker`. The current Deployment manifest specifies **2 replicas**. The worker can display `<none>` under `ROLES` because it has no role label.

The migration applied the existing app manifests in this order:

~~~sh
kind create cluster --name devops-two-nodes --config kind/two-nodes.yaml --wait 120s
kubectl --context kind-devops-two-nodes apply -f k8s/app/namespace.yaml
kubectl --context kind-devops-two-nodes apply -f k8s/app/configmap.yaml
kubectl --context kind-devops-two-nodes apply -f k8s/app/deployment.yaml
kubectl --context kind-devops-two-nodes apply -f k8s/app/service.yaml
kubectl --context kind-devops-two-nodes -n devops-app rollout status deployment/devops-app --timeout=120s
kubectl --context kind-devops-two-nodes -n devops-app get pods -o wide
~~~

After verifying HTTP responses in the new cluster, the old cluster was removed:

~~~sh
kind delete cluster --name devops-solo
kubectl config use-context kind-devops-two-nodes
kind get clusters
~~~

The remaining kind cluster is `devops-two-nodes`. For laptop access, keep this command running:

~~~sh
kubectl --context kind-devops-two-nodes -n devops-app port-forward service/devops-app 3002:80
~~~

In another terminal:

~~~sh
curl http://127.0.0.1:3002/
curl http://127.0.0.1:3002/health
~~~

Verified responses are `{"message":"Hello from updated Kubernetes!"}` and `{"status":"ok"}`. A running Cloudflare tunnel targeting `http://127.0.0.1:3002` uses the new port-forward; public access must be checked separately. Restart the port-forward if its selected Pod is replaced or the forwarding process stops.

## Original walkthrough — 12 October 2026

This document records the steps completed with the existing Node.js app: creating a local Kubernetes cluster, manually applying the app resources, supplying configuration through a ConfigMap, accessing the app from the laptop, updating the greeting, and accessing the app from another device through a Cloudflare tunnel.

Recorded on **12 October 2026**, using the current repository files and the terminal output supplied during the learning session. This is the solo implementation. Team integration, shared-system captures, and Pillar 3 observability are separate work.

Commands are replay instructions. Outputs explicitly marked **recorded** come from the conversation or saved evidence; outputs marked **expected** illustrate what successful execution looks like. Tool installation instructions reproduce the selected MacPorts approach, but there is no saved installation transcript. The cluster is not being checked live by this document.

## 1. What we built

| Item | Value |
| --- | --- |
| Application | Small Node.js HTTP API |
| Cluster tool | kind |
| Cluster name | `devops-solo` |
| kubectl context | `kind-devops-solo` |
| Node | `devops-solo-control-plane` |
| Recorded Kubernetes version | `v1.37.0` |
| App Namespace | `devops-app` |
| Deployment | `devops-app`, desired replicas: 1 |
| Container name | `api` |
| Pod label | `app=devops-app` |
| ConfigMap | `devops-app-config` |
| Service | `devops-app`, type `ClusterIP` |
| App listening port | `3000` |
| Service port → target port | `80 → 3000` |
| Laptop port for forwarding | `3002` |
| Current greeting | `Hello from updated Kubernetes!` |
| Current health response | `{"status":"ok"}` |
| Image | `ghcr.io/sangtruong-rgb/devops-app:f61db98cb9f8b288825a717958358ffde3bce39e` |

Saved evidence shows a Ready node, an available Deployment with a running Pod, and HTTP 200 responses through the public tunnel. Phone requests were reported successful in the conversation; phone screenshot files are not present in the evidence folder at the time of writing.

## 2. How the files and resources connect

~~~mermaid
flowchart TD
    Source["src/server.js"] -->|"Application source"| Build["Image build"]
    Dockerfile["dockerfile"] -->|"Runtime and build instructions"| Build
    CI[".github/workflows/ci.yml"] -->|"Lint, test, build and scan"| Build
    Build -->|"Publish after scans pass"| Image["Image in GHCR"]

    NF["namespace.yaml"]
    CF["configmap.yaml"]
    DF["deployment.yaml"]
    SF["service.yaml"]

    subgraph Cluster["Cluster: devops-solo"]
        subgraph NS["Namespace: devops-app"]
            CM["ConfigMap: devops-app-config"]
            D["Deployment: devops-app"]
            RS["ReplicaSet"]
            P["Pod with app=devops-app<br/>Container api runs Node.js on port 3000"]
            S["Service: devops-app<br/>Port 80, targetPort 3000"]
            D -->|"Creates and manages"| RS
            RS -->|"Maintains Pod count"| P
            CM -.->|"envFrom at container startup"| P
            S -->|"Selects matching Pods<br/>Normal cluster traffic"| P
        end
    end

    NF -->|"kubectl apply creates Namespace"| NS
    CF -->|"kubectl apply"| CM
    DF -->|"kubectl apply"| D
    SF -->|"kubectl apply"| S
    Image -->|"Node runtime pulls the image"| P
~~~

Files are definitions stored in the repository. Applying a file creates or updates an object stored in Kubernetes. The application does not open these YAML files on the laptop.

| File | Function |
| --- | --- |
| [server.js](../../src/server.js) | Handles HTTP requests and reads startup environment variables |
| [dockerfile](../../dockerfile) | Packages the app with its runtime and startup command |
| [ci.yml](../../.github/workflows/ci.yml) | Lints, tests, builds, scans and publishes the image |
| [namespace.yaml](../../k8s/app/namespace.yaml) | Defines the app Namespace |
| [configmap.yaml](../../k8s/app/configmap.yaml) | Defines configuration outside the image |
| [deployment.yaml](../../k8s/app/deployment.yaml) | Defines the desired Pod count, image, labels and configuration reference |
| [service.yaml](../../k8s/app/service.yaml) | Defines a stable in-cluster address and Pod selection |

Pillar 1 is documented separately in [pillar-1.md](pillar-1.md). Its workflow publishes images; it currently does not automatically deploy them to this Kubernetes cluster.

## 3. Step 1 — Prepare the tools

Work from the repository root:

~~~sh
cd /Users/sang.truong/Documents/devops
~~~

| Tool | Job |
| --- | --- |
| Docker Desktop | Runs the Linux environment and Docker containers used as kind nodes |
| kind | Creates a local Kubernetes cluster using containerized nodes |
| kubectl | Sends management requests to the Kubernetes API server |
| cloudflared | Opens a tunnel from the laptop to Cloudflare for external access |

Initial checks:

~~~sh
docker version
kubectl version --client
kind version
~~~

Docker needs both a Client and a working Server. `kind: command not found` showed that the terminal could not find kind.

We selected MacPorts because the laptop did not have Homebrew. Installation instructions:

~~~sh
port version
sudo port selfupdate
sudo port install kind
kind version
~~~

`port version` verifies MacPorts. `selfupdate` updates MacPorts and its port definitions. `install kind` installs the tool. `sudo` may request the laptop login password; password characters are not displayed.

**Recorded version output:**

~~~text
kind v0.33.0 go1.26.7 darwin/amd64
~~~

`darwin/amd64` means the kind executable runs on macOS with an Intel/x86-64 CPU. The app image and Kubernetes node run Linux inside Docker Desktop's Linux environment.

Installing kind does not create a cluster. That is a separate command.

## 4. Step 2 — Create the Kubernetes cluster

Start Docker Desktop, then run:

~~~sh
kind create cluster --name devops-solo --wait 120s
~~~

| Argument | Meaning |
| --- | --- |
| `kind` | Invoke the kind executable |
| `create cluster` | Create a Kubernetes cluster |
| `--name devops-solo` | Name the cluster |
| `--wait 120s` | Wait up to 120 seconds during the final control-plane readiness check |

With no custom cluster configuration, kind creates a one-node cluster. This node handles control-plane duties and can also run the app workload.

**Recorded creation output, shortened:**

~~~text
Creating cluster "devops-solo" ...
 ✓ Ensuring node image (kindest/node:v1.37.0)
 ✓ Preparing nodes
 ✓ Writing configuration
 ✓ Starting control-plane
 ✓ Installing CNI
 ✓ Installing StorageClass
 ✓ Waiting ≤ 2m0s for control-plane = Ready
 • Ready after 15s
Set kubectl context to "kind-devops-solo"
~~~

| Stage | What happens |
| --- | --- |
| Ensure node image | Obtain the image containing the Kubernetes node environment |
| Prepare nodes | Create and prepare the node container |
| Write configuration | Prepare Kubernetes configuration |
| Start control plane | Start the components that manage the cluster |
| Install CNI | Install the networking needed by Pods |
| Install StorageClass | Configure default storage provisioning support; the current app does not use persistent storage |
| Wait for Ready | Check control-plane node readiness |

The 120 seconds is not the cluster lifetime or a deadline for the entire command. Downloading and preparing the image happens before the final readiness wait.

For kind v0.33.0, a readiness wait timeout prints a warning and does not itself fail creation or delete the cluster. Other setup failures are separate errors. The readiness behavior is implemented in [kind's waitforready action](https://github.com/kubernetes-sigs/kind/blob/v0.33.0/pkg/cluster/internal/create/actions/waitforready/waitforready.go).

Check the cluster:

~~~sh
kubectl --context kind-devops-solo cluster-info
kubectl --context kind-devops-solo get nodes
~~~

**Recorded node check:**

~~~text
NAME                        STATUS   ROLES           AGE   VERSION
devops-solo-control-plane   Ready    control-plane   64m   v1.37.0
~~~

Times and generated values change between captures. Ready means the node is available for Kubernetes work.

### Context, cluster and kubeconfig

| Name | Meaning |
| --- | --- |
| `devops-solo` | Cluster name |
| `kind-devops-solo` | Context containing connection choices for that cluster |
| `devops-app` | Namespace for app resources inside the cluster |

A context is saved connection configuration, not an intermediate server. kubectl reads it and connects directly to the Kubernetes API server.

kind normally writes the connection settings into `~/.kube/config`. The `KUBECONFIG` environment variable can select other files, and an explicit `--kubeconfig` flag can also override the location.

Inspect the location setting and context names:

~~~sh
echo "$KUBECONFIG"
kubectl config current-context
kubectl config get-contexts
~~~

If `KUBECONFIG` is empty and no explicit override is used, kubectl uses the default file. Kubeconfig contains cluster access information; it is different from the app ConfigMap and should not be copied into public evidence.

## 5. Step 3 — Create the app Namespace

Create the directory:

~~~sh
mkdir -p k8s/app
~~~

`-p` creates missing parent directories and permits the directory to already exist.

Create `k8s/app/namespace.yaml`:

~~~yaml
apiVersion: v1
kind: Namespace
metadata:
  name: devops-app
~~~

| Field | Meaning |
| --- | --- |
| `apiVersion: v1` | Use the core Kubernetes API, version v1 |
| `kind: Namespace` | Define a Namespace object |
| `metadata.name` | Name it devops-app |

A Namespace groups resource names within a cluster. It is not a separate machine or container, and it does not alone enforce network isolation.

Apply the definition:

~~~sh
kubectl --context kind-devops-solo apply -f k8s/app/namespace.yaml
~~~

**Expected first-creation result:**

~~~text
namespace/devops-app created
~~~

Check the stored object:

~~~sh
kubectl --context kind-devops-solo get namespace devops-app
~~~

**Expected status:** `Active`.

`apply` creates or updates the object; `get` reads it. Creating the local file alone does not create the Namespace in Kubernetes.

## 6. Step 4 — Create configuration outside the image

The first ConfigMap definition used:

~~~yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: devops-app-config
  namespace: devops-app
data:
  PORT: "3000"
  GREETING: "Hello from Kubernetes!"
~~~

| Field | Meaning |
| --- | --- |
| `kind: ConfigMap` | Store non-secret configuration |
| `metadata.name` | Give the stored object a name that other resources can reference |
| `metadata.namespace` | Store the object in the app Namespace |
| `data` | String key/value pairs |
| `PORT` | Application setting consumed by server.js |
| `GREETING` | Application setting consumed by server.js |

Use strings for ConfigMap data; quoting `"3000"` prevents it being interpreted as a YAML number. Kubernetes does not treat the name PORT as a network-routing instruction. The JavaScript application gives that key its meaning.

Apply and inspect:

~~~sh
kubectl --context kind-devops-solo apply -f k8s/app/configmap.yaml
kubectl --context kind-devops-solo -n devops-app get configmap devops-app-config -o yaml
~~~

The initial inspection supplied in the conversation showed `GREETING: Hello from Kubernetes!` and `PORT: "3000"`.

The output also contained generated metadata such as UID, creation time, resource version, and kubectl's last-applied-configuration annotation. These describe the stored object; they do not need to be copied into the authored file.

The current greeting was changed later in Step 8. The current ConfigMap source snapshot is shown there.

## 7. Step 5 — Create the Deployment and start the app

Create `k8s/app/deployment.yaml`:

~~~yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devops-app
  namespace: devops-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: devops-app
  template:
    metadata:
      labels:
        app: devops-app
    spec:
      containers:
        - name: api
          image: ghcr.io/sangtruong-rgb/devops-app:f61db98cb9f8b288825a717958358ffde3bce39e
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: devops-app-config
~~~

### Read the nesting

| YAML path | Function |
| --- | --- |
| `apiVersion: apps/v1` | Use the apps API group, version v1 |
| `metadata` | Identity of the Deployment |
| `spec.replicas` | Desired number of Pods |
| `spec.selector.matchLabels` | Labels used to identify its managed Pods |
| `spec.template` | Blueprint used to create Pods |
| `spec.template.metadata.labels` | Labels assigned to those Pods |
| `spec.template.spec` | Configuration of each Pod |
| `containers` | List of containers inside each Pod |
| `containers[].name` | Name of the container: api |
| `containers[].image` | Published image to run |
| `containers[].ports` | Declaration of the intended container port |
| `containers[].envFrom` | Source of container environment variables |

The outer spec controls the Deployment. The inner template.spec controls the Pod. Similarly, the outer metadata identifies the Deployment, while template.metadata describes the Pods.

The Deployment creates a ReplicaSet, which maintains the desired Pod count. The node's kubelet and container runtime start the assigned Pod's containers. The current one-Pod workload contains one container.

The image reference identifies registry `ghcr.io`, repository `sangtruong-rgb/devops-app`, and a commit-based image tag. The runtime executes the files inside this image. Editing server.js on the laptop does not modify an already published image.

### Labels connect resources

These values must agree:

~~~text
Deployment selector: app=devops-app
Pod template label:  app=devops-app
Service selector:    app=devops-app
~~~

The key app and its value are chosen labels, not mandatory special names. They can differ from resource names and the Namespace name. However, a Deployment's selector cannot be changed in place after creation; redesigning that selector requires recreating the Deployment.

### Configuration becomes the container environment

envFrom references the ConfigMap object named devops-app-config in the same Namespace. Kubernetes supplies its entries when the container starts:

~~~text
ConfigMap PORT     → process.env.PORT
ConfigMap GREETING → process.env.GREETING
~~~

The existing application reads:

~~~javascript
const port = Number(process.env.PORT ?? 3000);
const server = createServer({ greeting: process.env.GREETING });
~~~

Its default greeting is defined by:

~~~javascript
export function createServer({ greeting = 'Hello from the DevOps app!' } = {}) {
~~~

Therefore the supplied ConfigMap greeting takes precedence over that default.

Apply the Deployment:

~~~sh
kubectl --context kind-devops-solo apply -f k8s/app/deployment.yaml
~~~

**Recorded result:**

~~~text
deployment.apps/devops-app created
~~~

Wait for the replica to become available:

~~~sh
kubectl --context kind-devops-solo -n devops-app rollout status deployment/devops-app --timeout=120s
~~~

**Recorded result:**

~~~text
Waiting for deployment "devops-app" rollout to finish: 0 of 1 updated replicas are available...
deployment "devops-app" successfully rolled out
~~~

This command watches the rollout. It does not start a separate app process, restart anything, or send an HTTP request. Its timeout stops the waiting command; Kubernetes continues its work.

Inspect Pods:

~~~sh
kubectl --context kind-devops-solo -n devops-app get pods
~~~

**Recorded early Pod check:**

~~~text
NAME                        READY   STATUS    RESTARTS   AGE
devops-app-c65c876d5-9x55f   1/1     Running   0          114s
~~~

Pod names can change after rollouts. The current evidence records a later replacement Pod.

Read app logs:

~~~sh
kubectl --context kind-devops-solo -n devops-app logs deployment/devops-app
~~~

**Expected startup message:**

~~~text
API listening on port 3000
~~~

Applying a Deployment prints the management operation result, not the ConfigMap values or an API response. The app starts automatically from the image's command; npm start on the laptop is unnecessary for this Kubernetes app.

The current Deployment contains no HTTP readiness/liveness probes or resource requests/limits. Ready status is separate from testing /health; the HTTP checks below verify the actual response.

## 8. Step 6 — Create the Service

Create `k8s/app/service.yaml`:

~~~yaml
apiVersion: v1
kind: Service
metadata:
  name: devops-app
  namespace: devops-app
spec:
  type: ClusterIP
  selector:
    app: devops-app
  ports:
    - port: 80
      targetPort: 3000
~~~

| Field | Function |
| --- | --- |
| `type: ClusterIP` | Provide an address reachable through the cluster network |
| `selector` | Find matching Pods in this Namespace |
| `port: 80` | Port clients use at the Service |
| `targetPort: 3000` | Destination port on the selected Pods |

The Service selects Pods by label, not by the Deployment name. Kubernetes tracks its backing Pod addresses through EndpointSlices.

Apply and inspect:

~~~sh
kubectl --context kind-devops-solo apply -f k8s/app/service.yaml
kubectl --context kind-devops-solo -n devops-app get service devops-app
~~~

**Recorded result:**

~~~text
NAME         TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
devops-app   ClusterIP   10.96.205.43   <none>        80/TCP    12s
~~~

The recorded IP is an internal Service address, not the laptop's public address. A recreated Service may receive a different IP.

Normal in-cluster traffic follows:

~~~text
Client → Service ClusterIP:80 → selected Pod:3000 → Node.js
~~~

For a client in the same Namespace, the Service DNS name is devops-app, for example `http://devops-app/health`. In another Namespace, the default kind cluster DNS name can be written `http://devops-app.devops-app.svc.cluster.local/health`.

These internal-Service requests were explained during learning but were not separately captured in this session. Port-forward and tunnel requests use a different access path.

## 9. Step 7 — Reach the app from the laptop

In terminal A, start port forwarding:

~~~sh
kubectl --context kind-devops-solo -n devops-app port-forward service/devops-app 3002:80
~~~

| Number | Location and function |
| --- | --- |
| `3002` | Local laptop port opened by kubectl |
| `80` | Service port used to resolve the destination |
| `3000` | Pod port selected from the Service's targetPort |

**Recorded forwarding message:**

~~~text
Forwarding from 127.0.0.1:3002 -> 3000
~~~

kubectl uses the Service to select a Pod and resolve port 80 to targetPort 3000. It forwards to that Pod through Kubernetes' forwarding connection. This bypasses ordinary Service ClusterIP routing.

The destination is port 3000 inside the Pod, not port 3000 on the laptop. Only the local port requested by the command is forwarded.

Keep terminal A running. In terminal B:

~~~sh
curl -i http://localhost:3002/
curl -i http://localhost:3002/health
~~~

`-i` includes response headers, so the HTTP status is visible.

**Expected responses at the initial greeting stage:**

~~~json
{"message":"Hello from Kubernetes!"}
~~~

~~~json
{"status":"ok"}
~~~

The greeting demonstrates environment-variable configuration. The health response verifies that the HTTP route responds.

The listener bound to 0.0.0.0 inside the Pod is started by server.js. containerPort and EXPOSE declarations do not themselves start listeners or open laptop ports.

## 10. Step 8 — Update the greeting without rebuilding the image

We changed only the ConfigMap greeting. Current `k8s/app/configmap.yaml`:

~~~yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: devops-app-config
  namespace: devops-app
data:
  PORT: "3000"
  GREETING: "Hello from updated Kubernetes!"
~~~

Apply the changed configuration:

~~~sh
kubectl --context kind-devops-solo apply -f k8s/app/configmap.yaml
~~~

At this point, the stored ConfigMap has changed, but an existing container keeps its original environment.

Trigger replacement Pods:

~~~sh
kubectl --context kind-devops-solo -n devops-app rollout restart deployment/devops-app
~~~

**Recorded restart acknowledgement:**

~~~text
deployment.apps/devops-app restarted
~~~

Wait for the rollout:

~~~sh
kubectl --context kind-devops-solo -n devops-app rollout status deployment/devops-app --timeout=120s
~~~

The restart changes the Pod template's restart annotation, causing a rollout. New containers read the current ConfigMap. The image reference remains unchanged.

The previous forwarding connection targets the old Pod, so stop it with Ctrl+C if still running and start it again:

~~~sh
kubectl --context kind-devops-solo -n devops-app port-forward service/devops-app 3002:80
~~~

In another terminal:

~~~sh
curl -i http://localhost:3002/
~~~

The updated greeting is also confirmed by the saved public response:

~~~json
{"message":"Hello from updated Kubernetes!"}
~~~

The three stages differ:

| Stage | What changes |
| --- | --- |
| Save configmap.yaml | Local file |
| Apply ConfigMap | Configuration stored in Kubernetes |
| Replacement containers start | Environment values used by the application |

This restart behavior applies to environment variables. ConfigMaps mounted as files can eventually update without replacing the Pod, but the application must support reading the changed files.

## 11. Step 9 — Install cloudflared and expose a temporary URL

MacPorts installation instruction:

~~~sh
sudo port install cloudflared
cloudflared --version
~~~

**Recorded version output:**

~~~text
cloudflared version 2026.10.0 (built 2026-10-06T06:32:55Z)
~~~

With port-forward still running, check the origin:

~~~sh
curl http://localhost:3002/health
~~~

In another terminal, start a Quick Tunnel:

~~~sh
cloudflared tunnel --url http://127.0.0.1:3002
~~~

`--url` specifies the local origin. Quick Tunnels generate a temporary public URL without requiring a Cloudflare account or domain.

**Recorded URL:**

~~~text
https://labor-sic-etc-ingredients.trycloudflare.com
~~~

This is the historical URL for the recorded run. It is not a permanent app address. Use the newly generated URL when starting a new tunnel.

**Recorded connection line, shortened:**

~~~text
Registered tunnel connection ... location=hkg10 protocol=quic
~~~

The log also reported no default configuration file, but a Quick Tunnel connection was established. One UDP precheck failed while another passed; both HTTP/2 prechecks passed, and the precheck recommended HTTP/2. The supplied log does not show a subsequent registered HTTP/2 connection, so it does not prove which transport handled the saved requests.

Most importantly, the saved HTTP responses prove that the complete request path worked.

### External request path

~~~mermaid
flowchart TD
    Phone["Phone on mobile data"] -->|"HTTPS"| Edge["Cloudflare public URL"]
    Edge -->|"Through the tunnel"| Tunnel["cloudflared on laptop"]
    Tunnel -->|"HTTP to 127.0.0.1:3002"| Forward["kubectl port-forward"]
    Forward --> API["Kubernetes API server"]
    API --> Kubelet["Node kubelet / runtime forwarding"]
    Kubelet -->|"Pod port 3000"| App["Node.js API"]
    Service["Service selector and port mapping"] -.->|"Used to select Pod and target port"| Forward
~~~

Both port-forward and cloudflared must remain running for this access path. cloudflared initiates the tunnel connection from the laptop; public requests are carried back through it to the local origin.

Stopping cloudflared ends public access. It does not stop the Deployment or app Pod.

## 12. Step 10 — Test from another device

The instructions used a phone with Wi-Fi disabled and mobile data enabled, so the request came from another network.

Open the generated URL at:

~~~text
https://<generated-host>.trycloudflare.com/
https://<generated-host>.trycloudflare.com/health
~~~

Expected bodies:

~~~json
{"message":"Hello from updated Kubernetes!"}
~~~

~~~json
{"status":"ok"}
~~~

The user reported this step complete. The device and network details are not independently visible in the laptop curl captures. Save phone screenshots to document that separate-device test.

The public URL is accessible to anyone with the URL while the Quick Tunnel is running.

## 13. Step 11 — Save the solo evidence

Create the folder:

~~~sh
mkdir -p docs/evidence/solo/pillar-2
~~~

Capture node and app resource status:

~~~sh
kubectl --context kind-devops-solo get nodes -o wide \
  | tee docs/evidence/solo/pillar-2/nodes.txt

kubectl --context kind-devops-solo -n devops-app get all \
  | tee docs/evidence/solo/pillar-2/resources.txt
~~~

`tee` both displays stdout and writes it to a file. Re-running these capture commands replaces the named files with the newer output.

Use the URL printed by the currently running tunnel. For the historical recorded session:

~~~sh
PILLAR2_TUNNEL_URL='https://labor-sic-etc-ingredients.trycloudflare.com'

curl -i "$PILLAR2_TUNNEL_URL/" \
  | tee docs/evidence/solo/pillar-2/public-greeting.txt

curl -i "$PILLAR2_TUNNEL_URL/health" \
  | tee docs/evidence/solo/pillar-2/public-health.txt
~~~

### Files present when this document was written

| Evidence | Recorded result |
| --- | --- |
| [nodes.txt](../evidence/solo/pillar-2/nodes.txt) | Ready control-plane node, Kubernetes v1.37.0, runtime containerd 2.3.4 |
| [resources.txt](../evidence/solo/pillar-2/resources.txt) | Pod Running and 1/1 Ready; Deployment 1/1 available; ClusterIP Service on 80/TCP |
| [public-greeting.txt](../evidence/solo/pillar-2/public-greeting.txt) | HTTP/2 200, updated greeting |
| [public-health.txt](../evidence/solo/pillar-2/public-health.txt) | HTTP/2 200, status ok |

The greeting response header is dated 12 October 2026 at 07:22:21 UTC, or **14:22:21 Vietnam time**. The health response is dated 07:22:25 UTC, or **14:22:25 Vietnam time**.

The saved resource output contains:

~~~text
pod/devops-app-6b9dfd75f7-mrgkx          1/1 Running
service/devops-app                      ClusterIP 10.96.205.43 80/TCP
deployment.apps/devops-app              1/1 available
replicaset.apps/devops-app-6b9dfd75f7    desired 1
replicaset.apps/devops-app-c65c876d5     desired 0
~~~

This excerpt is shortened for readability. See the raw file for complete columns.

The older ReplicaSet at zero replicas is consistent with retaining rollout history after replacing Pods.

Suggested screenshot filenames, **not yet present in this folder**:

~~~text
phone-greeting.png
phone-health.png
~~~

The brief asks for node status, app resources and a real response, plus access from another device through a tunnel. Its requirements are the assignment reference; they do not imply permission to automate future implementation steps. Solo evidence belongs here. The team's graded /captures must come from its shared system, not be presented as captures of this personal cluster.

## 14. Understand the command-line syntax

Remember:

~~~text
kubectl [WHERE] [ACTION] [TARGET] [OPTIONS]
~~~

For example:

~~~sh
kubectl --context kind-devops-solo -n devops-app get configmap devops-app-config -o yaml
~~~

| Part | Meaning |
| --- | --- |
| `--context kind-devops-solo` | Select the cluster connection |
| `-n devops-app` | Select the Namespace |
| `get` | Read |
| `configmap devops-app-config` | Resource type and name |
| `-o yaml` | Output format |

Other actions:

| Action | Function |
| --- | --- |
| `apply -f FILE` | Create or update objects from a file |
| `get` | Read resource state |
| `describe` | Read detailed state and events |
| `logs` | Read container output |
| `rollout restart` | Trigger replacement Pods for a Deployment |
| `rollout status` | Watch rollout progress |
| `port-forward` | Open a temporary connection from the laptop to a Pod |
| `scale` | Change a workload's desired replica count |

Resource field documentation and command help:

~~~sh
kubectl --context kind-devops-solo explain configmap
kubectl --context kind-devops-solo explain configmap.data
kubectl --context kind-devops-solo explain deployment.spec.template
kubectl get --help
kubectl apply --help
~~~

These are learning/reference commands; their output was not captured as implementation evidence.

## 15. Understand apiVersion

apiVersion selects the Kubernetes API group/version used to describe and manage an object. It identifies supported fields and rules, not the application version, cluster release, operation type, or change history.

| Resource | API group | Version | YAML value |
| --- | --- | --- | --- |
| Namespace | Core, empty group name | v1 | `v1` |
| ConfigMap | Core, empty group name | v1 | `v1` |
| Service | Core, empty group name | v1 | `v1` |
| Deployment | apps | v1 | `apps/v1` |

For named groups, the format is group/version. The core group is a special case written as just v1, not core/v1.

One API version can support many operations:

| Operation | HTTP method |
| --- | --- |
| Read | GET |
| Create | POST |
| Update | PUT or PATCH |
| Delete | DELETE |

For your stored ConfigMap, a direct read uses:

~~~sh
kubectl --context kind-devops-solo get --raw \
  /api/v1/namespaces/devops-app/configmaps/devops-app-config
~~~

This command was offered as a learning example, not captured as executed work. kubectl normally determines these paths for you.

A real compatibility example: old Deployment APIs apps/v1beta1, apps/v1beta2 and extensions/v1beta1 stopped being served beginning with Kubernetes 1.16. Modern manifests use apps/v1. The migration also requires an explicit selector, demonstrating that version changes can change validation rules. See the [official migration guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/#deployment-v116).

## 16. Understand Pods, containers and replicas

A container runs a process from an image. A Pod groups one or more containers as a unit scheduled onto one node.

Containers in the same Pod share networking and can use localhost to communicate. They can share explicitly configured volumes, while retaining their own images and filesystems.

They do not need to be identical. An app and a closely related helper can occupy one Pod.

In our Deployment:

~~~text
replicas: 1 + one container entry
    → one Pod with one api container

replicas: 3 + one container entry
    → three Pods, each with one api container
~~~

The three-replica setup is an explanation, not an implemented change. The current file and saved evidence request one replica.

Different applications commonly use separate Pods/workloads so they can be updated, scaled and configured independently. Different Pods can communicate through Services when networking policies permit; localhost refers to the caller's own Pod.

If a container crashes, kubelet can restart it within its Pod. If a managed Pod disappears, its ReplicaSet creates a replacement Pod.

## 17. Troubleshooting questions we resolved

| Observation | Explanation / next check |
| --- | --- |
| kind: command not found | Install kind or fix PATH; the kind version output confirmed installation |
| apply prints only created/configured | It reports a Kubernetes management operation, not app output |
| ConfigMap values are not printed at startup | The app logs only its listening port; read the ConfigMap or call the greeting route |
| Greeting differs from source default | Deployment supplies GREETING from ConfigMap |
| Saving YAML has no runtime effect | Apply the file to update the stored object |
| Applying ConfigMap leaves old greeting | Existing container environment is unchanged; replace Pods |
| Restart prints only restarted | It acknowledges the request; use rollout status and logs |
| App is running but localhost request fails | Check the forwarding process and local port |
| Forwarding dies after a restart | It targeted the replaced Pod; restart port-forward |
| Service targets the wrong port | Match targetPort with the application's real listening port |
| Service finds no Pods | Check Namespace and selector against Pod labels |
| cloudflared has a transport warning | Inspect connection logs and verify actual requests; a warning alone is not an end-to-end failure |

Useful read-only diagnostics:

~~~sh
kubectl --context kind-devops-solo -n devops-app get deployments,replicasets,pods --show-labels
kubectl --context kind-devops-solo -n devops-app describe deployment devops-app
kubectl --context kind-devops-solo -n devops-app get endpointslices -l kubernetes.io/service-name=devops-app
kubectl --context kind-devops-solo -n devops-app get events --sort-by=.metadata.creationTimestamp
~~~

These diagnostics are reference commands, not recorded proof that each was run.

## 18. Stop and resume the lab

This lifecycle procedure was discussed. There is no captured output proving the scale-to-zero operation was executed.

### End temporary access

Press Ctrl+C in the port-forward and cloudflared terminals. The Pod continues running in Kubernetes.

### Optionally stop app Pods while preserving definitions

~~~sh
kubectl --context kind-devops-solo -n devops-app scale deployment/devops-app --replicas=0
~~~

The Deployment, ConfigMap and Service remain. The cluster still consumes resources. Applying deployment.yaml again restores its declared replica count of 1.

### Resume the app

~~~sh
kubectl --context kind-devops-solo -n devops-app scale deployment/devops-app --replicas=1
kubectl --context kind-devops-solo -n devops-app rollout status deployment/devops-app --timeout=120s
~~~

In one terminal:

~~~sh
kubectl --context kind-devops-solo -n devops-app port-forward service/devops-app 3002:80
~~~

In another terminal, if external access is needed:

~~~sh
cloudflared tunnel --url http://127.0.0.1:3002
~~~

Use the new generated public URL. A separate terminal or browser can send requests.

Quitting Docker Desktop stops the local Docker environment. On returning, start Docker Desktop and check node/Pod status before assuming the lab is ready:

~~~sh
kubectl --context kind-devops-solo get nodes
kubectl --context kind-devops-solo -n devops-app get pods
~~~

There is no need to rebuild the app image for a normal stop/resume.

## 19. Discussed extension — Configurable health response

We discussed changing the JSON response from status ok to status fine using HEALTH_STATUS.

**This extension is not implemented in the current files.** server.js still returns a hardcoded status ok, and configmap.yaml contains only PORT and GREETING. The saved public health response also shows status ok.

The required future changes would be:

1. Add a healthStatus parameter with default ok to createServer.
2. Use healthStatus in the /health response body.
3. Pass process.env.HEALTH_STATUS when starting the server.
4. Add HEALTH_STATUS: "fine" to ConfigMap.
5. Test locally, build/publish a new image and update the Deployment image reference.
6. Apply the updated ConfigMap before starting the new Pods and verify the response.

Adding a ConfigMap key alone cannot change code that does not read that setting. Changing this JSON field would not itself change HTTP status 200 or implement a real health check.

## 20. What is verified and what remains separate

| Item | Status / basis |
| --- | --- |
| Local cluster | Recorded creation output and saved Ready node capture |
| Dedicated app Namespace | Present in manifests; saved workload resources were queried in that Namespace |
| Manual Deployment and Service | Recorded apply/check output and saved resources |
| ConfigMap-driven greeting | Current source and saved updated public greeting |
| Public HTTP access | Two saved HTTP/2 200 responses |
| Different-device access | User reported phone test complete; screenshot files still need saving |
| Internal Service routing request | Explained, but not separately captured |
| Health-status customization | Discussed, not implemented |
| Shutdown/scale-to-zero | Discussed, not evidenced as executed |
| Shared team system and graded captures | Separate checkpoint/integration work |
| Metrics, Prometheus, Grafana and load testing | Pillar 3; not added here |

This walkthrough records the implementation reached during the session, rather than marking the entire team's assignment complete.

## 21. Official references

- [kind quick start](https://kind.sigs.k8s.io/docs/user/quick-start/): installation, cluster creation and context usage.
- [MacPorts kind](https://ports.macports.org/port/kind/): kind package.
- [MacPorts cloudflared](https://ports.macports.org/port/cloudflared/): tunnel client installation.
- [Kubernetes Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/): resource scopes.
- [Kubernetes ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/): configuration and update behavior.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/): Pod templates, ReplicaSets and rollouts.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/): selectors and ports.
- [kubectl port-forward](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_port-forward/): selecting a Pod and forwarding to its target port.
- [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/): versioned management APIs.
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/): temporary external access.
- [Distroless Node.js](https://github.com/GoogleContainerTools/distroless/blob/main/nodejs/README.md): image entrypoint and startup behavior.

