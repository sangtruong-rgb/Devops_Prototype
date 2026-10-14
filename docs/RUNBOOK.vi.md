# Hướng dẫn chạy toàn bộ DevOps Prototype

Tài liệu này tổng hợp lệnh theo code và manifest trong repo: tạo cluster kind → build ứng dụng → triển khai Kubernetes → chạy Prometheus/Grafana → tạo traffic → kiểm tra, cập nhật và dọn lab. Các kết quả ghi là **kỳ vọng**, không phải bản ghi một lần triển khai thực tế.

Chạy **mục 1–6 theo thứ tự** trong terminal chính. Mục 7 cần thêm các terminal để giữ kết nối mở. Các mục phía sau dùng khi cần. Lệnh dành cho macOS với zsh/bash; dừng và xử lý nếu một bước báo lỗi.

## 1. Vào đúng thư mục và kiểm tra công cụ

Đường dẫn trên máy hiện tại:

```sh
cd /Users/macbookpro/Documents/devops/Devops_Prototype
pwd
ls package.json dockerfile kind/two-nodes.yaml

docker version
kind version
kubectl version --client
node --version
npm --version
openssl version
```

Nếu chuyển sang máy khác, thay đường dẫn `cd` bằng thư mục chứa `package.json`, `dockerfile`, `kind/` và `k8s/`. Repo dùng tên **`dockerfile` viết thường**, nên lệnh build có `-f dockerfile`.

Cần Docker Desktop đang chạy, kind, kubectl, Node.js/npm, curl và OpenSSL. Dùng **Node.js 24** để đồng bộ Dockerfile và CI. `docker version` phải kết nối được phần **Server**. Nếu Docker Desktop đã cài nhưng chưa mở:

```sh
open -a Docker
```

Đợi Docker sẵn sàng rồi chạy lại `docker version`. Không cần bật Kubernetes tích hợp của Docker Desktop: lab dùng kind.

### Các thành phần trong repo

| Thành phần | File/cấu hình | Giá trị dùng trong lab |
| --- | --- | --- |
| HTTP API và metrics | `src/server.js`, `src/metrics.js` | `/`, `/health`, `/metrics`; port 3000 |
| Cluster | `kind/two-nodes.yaml` | 1 control-plane + 1 worker |
| Ứng dụng | `k8s/app/` | Namespace/Deployment/Service: `devops-app`; 2 replicas; container `api` |
| Cấu hình app | `k8s/app/configmap.yaml` | `PORT=3000`, `GREETING=Hello from updated Kubernetes!` |
| Service app | `k8s/app/service.yaml` | ClusterIP, port 80 → container port 3000 |
| Prometheus | `k8s/monitoring/prometheus.yaml` | Namespace `monitoring`; image `prom/prometheus:v3.14.0` |
| Thu thập metrics | `k8s/monitoring/prometheus/prometheus.yml` | Scrape trực tiếp từng Pod mỗi 15 giây |
| Grafana | `k8s/monitoring/grafana.yaml` | Namespace `monitoring`; image `grafana/grafana:13.2.2` |
| Dashboard/datasource | `k8s/monitoring/grafana/` | Tự provision khi triển khai |
| Đóng gói monitoring | `k8s/monitoring/kustomization.yaml` | Dùng `kubectl apply -k` |

Hai node đều là container trên cùng máy. Hai replica app không có nghĩa mỗi node chạy một Pod; cấu hình hiện tại có thể đặt cả hai Pod trên worker.

## 2. Tạo cluster kind gồm 2 node

Kiểm tra cluster đã tồn tại chưa:

```sh
kind get clusters
```

Nếu **chưa có** `devops-two-nodes`, tạo bằng file trong repo:

```sh
kind create cluster \
  --name devops-two-nodes \
  --config kind/two-nodes.yaml \
  --wait 120s
```

Nếu đã có cluster này, bỏ qua lệnh tạo và kiểm tra nó. Nếu mất kubeconfig nhưng cluster còn tồn tại, xuất lại cấu hình kết nối:

```sh
kind export kubeconfig --name devops-two-nodes
```

Xác nhận trạng thái:

```sh
kubectl --context kind-devops-two-nodes cluster-info
kubectl --context kind-devops-two-nodes wait \
  --for=condition=Ready nodes --all --timeout=180s
kubectl --context kind-devops-two-nodes get nodes -o wide
```

Kỳ vọng có `devops-two-nodes-control-plane` và `devops-two-nodes-worker`, đều `Ready`. Các lệnh trong tài liệu luôn chỉ rõ context để chọn đúng cluster.

## 3. Kiểm tra code, build và nạp image ứng dụng

Theo README của repo, image GHCR đang ghi trong `k8s/app/deployment.yaml` là bản cũ chưa chứa `/metrics`. Vì vậy, luồng chạy local dưới đây build từ source hiện tại và thay image trong bản manifest gửi lên cluster.

```sh
npm ci
npm run lint
npm test
```

Chỉ tiếp tục khi lint và test thành công:

```sh
APP_IMAGE="devops-app:local-$(date +%Y%m%d%H%M%S)"
docker build -f dockerfile -t "$APP_IMAGE" .
kind load docker-image "$APP_IMAGE" --name devops-two-nodes
```

Giữ terminal này để biến `APP_IMAGE` còn giá trị ở bước sau. Tag riêng cho mỗi lần build giúp Kubernetes phân biệt phiên bản. Image được load vào các node kind, không cần push registry để chạy local. Với tag này và manifest hiện tại, pull policy mặc định là `IfNotPresent`.

## 4. Triển khai ứng dụng lên Kubernetes

Tạo namespace và các tài nguyên phụ thuộc trước:

```sh
kubectl --context kind-devops-two-nodes apply -f k8s/app/namespace.yaml
kubectl --context kind-devops-two-nodes apply -f k8s/app/configmap.yaml
kubectl --context kind-devops-two-nodes apply -f k8s/app/service.yaml
```

Thay image **ở bản manifest được render local** rồi apply. File gốc trong repo giữ nguyên:

```sh
set -o pipefail
kubectl set image --local -f k8s/app/deployment.yaml \
  api="${APP_IMAGE:?Chay buoc build image o muc 3 truoc}" -o yaml \
  | kubectl --context kind-devops-two-nodes apply -f -

kubectl --context kind-devops-two-nodes -n devops-app \
  rollout status deployment/devops-app --timeout=180s

kubectl --context kind-devops-two-nodes -n devops-app get deployments,pods,services -o wide
kubectl --context kind-devops-two-nodes -n devops-app \
  get deployment devops-app -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

Kỳ vọng Deployment có `READY 2/2`, hai Pod Running và image trùng tag vừa build. Nếu sau này chạy `apply -f k8s/app/deployment.yaml` trực tiếp, image cũ trong file sẽ được áp lại; dùng cách render ở trên hoặc cập nhật image trong file trước.

## 5. Chuẩn bị tài khoản Grafana

Tạo namespace monitoring:

```sh
kubectl --context kind-devops-two-nodes apply -f k8s/monitoring/namespace.yaml
kubectl --context kind-devops-two-nodes -n monitoring get secret grafana-admin
```

Nếu kết quả là **NotFound**, chạy lệnh sau **một lần** để tạo tài khoản `admin` với mật khẩu ngẫu nhiên. Nếu Secret đã tồn tại, giữ lại và bỏ qua lệnh tạo. Nếu lỗi kết nối hoặc quyền truy cập, xử lý lỗi đó trước.

```sh
kubectl --context kind-devops-two-nodes -n monitoring create secret generic grafana-admin \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$(openssl rand -hex 24)"
```

Grafana đọc hai key `admin-user`, `admin-password` từ Secret này khi khởi tạo. Thiếu Secret sẽ khiến Pod không khởi động được.

## 6. Triển khai Prometheus và Grafana

Có thể kiểm tra bản render Kustomize trước:

```sh
kubectl kustomize k8s/monitoring > /tmp/devops-monitoring.yaml
```

Triển khai:

```sh
kubectl --context kind-devops-two-nodes apply -k k8s/monitoring

kubectl --context kind-devops-two-nodes -n monitoring \
  rollout status deployment/prometheus --timeout=180s
kubectl --context kind-devops-two-nodes -n monitoring \
  rollout status deployment/grafana --timeout=180s

kubectl --context kind-devops-two-nodes -n monitoring get deployments,pods,services
```

Kỳ vọng mỗi Deployment monitoring có `READY 1/1`. Dùng **`apply -k`**, vì Kustomize tạo ConfigMap từ cấu hình Prometheus, alert, datasource và dashboard JSON. `apply -f k8s/monitoring` không thực hiện bước sinh ConfigMap này.

Namespace `devops-app` phải tồn tại từ mục 4: Role và RoleBinding cho Prometheus đọc danh sách Pod được đặt trong namespace ứng dụng.

## 7. Mở ứng dụng, Prometheus và Grafana

Mỗi lệnh `port-forward` chạy liên tục: mở **ba terminal riêng**, giữ chúng hoạt động.

**Terminal A — ứng dụng:**

```sh
kubectl --context kind-devops-two-nodes -n devops-app \
  port-forward service/devops-app 3002:80
```

**Terminal B — Prometheus:**

```sh
kubectl --context kind-devops-two-nodes -n monitoring \
  port-forward service/prometheus 9090:9090
```

**Terminal C — Grafana:**

```sh
kubectl --context kind-devops-two-nodes -n monitoring \
  port-forward service/grafana 3003:3000
```

| Dịch vụ | Địa chỉ trên laptop | Mục đích |
| --- | --- | --- |
| API | http://localhost:3002/ | Greeting |
| Health | http://localhost:3002/health | Kiểm tra app |
| Metrics | http://localhost:3002/metrics | Metrics dạng text |
| Prometheus | http://localhost:9090 | Truy vấn, Targets, Alerts |
| Grafana | http://localhost:3003 | Dashboard |

Ở terminal chính, lấy tài khoản đăng nhập Grafana:

```sh
kubectl --context kind-devops-two-nodes -n monitoring get secret grafana-admin \
  -o jsonpath='{.data.admin-user}' | openssl base64 -d -A
printf '\n'
kubectl --context kind-devops-two-nodes -n monitoring get secret grafana-admin \
  -o jsonpath='{.data.admin-password}' | openssl base64 -d -A
printf '\n'
```

Đăng nhập Grafana, mở **Dashboards → DevOps → DevOps API Overview**. Datasource Prometheus và dashboard đã được nạp từ repo, không cần tạo thủ công. Datasource dùng địa chỉ nội bộ `http://prometheus.monitoring.svc.cluster.local:9090`.

`Ctrl+C` chỉ dừng port-forward, không dừng các Pod. Nếu Pod được thay thế và forwarding bị ngắt, chạy lại lệnh tương ứng.

## 8. Kiểm tra end-to-end và tạo traffic

### Kiểm tra HTTP

Chạy ở terminal chính khi ba terminal port-forward vẫn mở:

```sh
curl -fsS http://localhost:3002/
printf '\n'
curl -fsS http://localhost:3002/health
printf '\n'
curl -fsS http://localhost:3002/metrics
curl -fsS http://localhost:9090/-/ready
curl -fsS http://localhost:3003/api/health
```

Greeting kỳ vọng là `{"message":"Hello from updated Kubernetes!"}`, health là `{"status":"ok"}`. `/metrics` phải trả text metrics, không phải JSON 404.

Mở **Targets** trong Prometheus: job `devops-app` cần có **2 target UP** sau khi Pod ổn định. Target của chính Prometheus là một job riêng. Có thể xem bằng API:

```sh
curl -fsS 'http://localhost:9090/api/v1/targets?state=active'
curl -fsSG http://localhost:9090/api/v1/query \
  --data-urlencode 'query=up{job="devops-app"}'
```

### Tạo traffic khoảng 2 phút

```sh
for i in $(seq 1 600); do
  curl -fsS http://localhost:3002/ > /dev/null
  curl -sS http://localhost:3002/missing > /dev/null
  sleep 0.2
done
```

Mỗi vòng gửi một request 200 và một request 404. Request 404 dùng `curl` không có `-f` vì đây là phản hồi được chủ động tạo để có số liệu 4xx. Có thể nhấn `Ctrl+C` để dừng sớm.

Port-forward Service chọn một Pod nên traffic này chủ yếu vào một replica. Để gửi qua Service bên trong cluster, có thể tạo một Pod tạm bằng chính image app đang chạy:

```sh
APP_IMAGE="$(kubectl --context kind-devops-two-nodes -n devops-app \
  get deployment devops-app -o jsonpath='{.spec.template.spec.containers[0].image}')"

kubectl --context kind-devops-two-nodes -n devops-app run traffic-generator \
  --rm -i --restart=Never --image="$APP_IMAGE" --image-pull-policy=IfNotPresent \
  -- -e 'for (let i = 0; i < 600; i++) { for (const path of ["/", "/missing"]) { const r = await fetch("http://devops-app.devops-app.svc.cluster.local" + path, { headers: { Connection: "close" } }); await r.text(); } await new Promise(resolve => setTimeout(resolve, 200)); }'
```

Image distroless có entrypoint Node.js nên truyền `-e` trực tiếp; không dùng `sh` bên trong image app. Lệnh trên mở kết nối mới để traffic có thể được phân phối qua Service; không bảo đảm chia đều tuyệt đối giữa hai Pod. Nếu bị ngắt và Pod tạm còn tồn tại:

```sh
kubectl --context kind-devops-two-nodes -n devops-app delete pod traffic-generator --ignore-not-found
```

### Xem biểu đồ và PromQL

Đợi ít nhất hai lượt scrape (khoảng 30 giây), chọn khung thời gian **Last 15 minutes** hoặc **Last 30 minutes** trong Grafana. Chạy từng biểu thức riêng trong Prometheus:

```promql
up{job="devops-app"}
```

```promql
sum(rate(http_requests_total{job="devops-app"}[5m]))
```

```promql
sum by (status_code) (rate(http_requests_total{job="devops-app"}[5m]))
```

```promql
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="devops-app"}[5m])))
```

App không tính `/health` và `/metrics` vào counter/histogram HTTP. Chỉ gọi health sẽ không tạo dữ liệu request cho dashboard. Route sai được gom thành `unmatched`. Traffic ở trên tạo 4xx; app chưa có route chủ động sinh lỗi 500. Biểu đồ CPU/RAM đo tiến trình Node.js, không phải toàn cluster.

## 9. Cập nhật code hoặc cấu hình

### Sau khi sửa source app

Chạy từ thư mục gốc dự án, build với tag mới rồi cập nhật Deployment:

```sh
npm run lint
npm test
APP_IMAGE="devops-app:local-$(date +%Y%m%d%H%M%S)"
docker build -f dockerfile -t "$APP_IMAGE" .
kind load docker-image "$APP_IMAGE" --name devops-two-nodes
kubectl --context kind-devops-two-nodes -n devops-app \
  set image deployment/devops-app api="$APP_IMAGE"
kubectl --context kind-devops-two-nodes -n devops-app \
  rollout status deployment/devops-app --timeout=180s
```

### Sau khi sửa greeting trong ConfigMap

Sửa `GREETING` ở `k8s/app/configmap.yaml`, sau đó:

```sh
kubectl --context kind-devops-two-nodes apply -f k8s/app/configmap.yaml
kubectl --context kind-devops-two-nodes -n devops-app rollout restart deployment/devops-app
kubectl --context kind-devops-two-nodes -n devops-app \
  rollout status deployment/devops-app --timeout=180s
```

Biến môi trường từ ConfigMap chỉ được nạp khi container khởi động. Nếu đổi `PORT`, cần đồng bộ container port, Service và probe; đổi greeting thì không cần build lại image.

### Sau khi sửa Prometheus, alert, datasource hoặc dashboard

```sh
kubectl --context kind-devops-two-nodes apply -k k8s/monitoring
kubectl --context kind-devops-two-nodes -n monitoring \
  rollout status deployment/prometheus --timeout=180s
kubectl --context kind-devops-two-nodes -n monitoring \
  rollout status deployment/grafana --timeout=180s
```

Kustomize sinh tên ConfigMap có hash; thay nội dung cấu hình làm Deployment liên quan thay Pod. **Dữ liệu trên `emptyDir` của Pod bị thay sẽ mất**, bao gồm lịch sử Prometheus hoặc thay đổi Grafana lưu trong database. Dashboard và datasource trong Git được provision lại.

### Xem lịch sử và rollback ứng dụng

```sh
kubectl --context kind-devops-two-nodes -n devops-app rollout history deployment/devops-app
```

Nếu bản cập nhật lỗi và muốn quay về revision trước:

```sh
kubectl --context kind-devops-two-nodes -n devops-app rollout undo deployment/devops-app
kubectl --context kind-devops-two-nodes -n devops-app \
  rollout status deployment/devops-app --timeout=180s
```

Rollback không khôi phục nội dung ConfigMap; image của revision trước phải còn trong node hoặc pull được. Nếu revision trước dùng image cũ không có `/metrics`, monitoring sẽ bị ảnh hưởng.

## 10. Các lệnh kiểm tra và xử lý lỗi

```sh
kubectl --context kind-devops-two-nodes get nodes -o wide
kubectl --context kind-devops-two-nodes -n devops-app get pods -o wide --show-labels
kubectl --context kind-devops-two-nodes -n monitoring get pods -o wide
kubectl --context kind-devops-two-nodes -n devops-app describe deployment devops-app
kubectl --context kind-devops-two-nodes -n monitoring describe pods
kubectl --context kind-devops-two-nodes -n devops-app get events --sort-by=.metadata.creationTimestamp
kubectl --context kind-devops-two-nodes -n monitoring get events --sort-by=.metadata.creationTimestamp

kubectl --context kind-devops-two-nodes -n devops-app \
  logs -l app=devops-app -c api --prefix=true --tail=100
kubectl --context kind-devops-two-nodes -n monitoring logs deployment/prometheus --tail=100
kubectl --context kind-devops-two-nodes -n monitoring logs deployment/grafana --tail=100

kubectl --context kind-devops-two-nodes -n devops-app \
  get endpointslices -l kubernetes.io/service-name=devops-app
kubectl --context kind-devops-two-nodes -n devops-app \
  auth can-i list pods --as=system:serviceaccount:monitoring:prometheus
```

| Hiện tượng | Cách xử lý |
| --- | --- |
| Docker không kết nối được | Mở Docker Desktop, đợi Server sẵn sàng, kiểm tra `docker version` |
| Cluster đã tồn tại | Bỏ qua tạo cluster; kiểm tra nodes, không cần xóa để chạy lại |
| `ImagePullBackOff` ở app | Xem Events; kiểm tra image Deployment, tag đã build và `kind load` vào đúng cluster |
| `ImagePullBackOff` ở monitoring | Xem Events để biết tag/registry/network nào lỗi; đối chiếu image trong manifest |
| App `/metrics` trả 404 | Build source hiện tại và triển khai image mới theo mục 3–4 |
| Prometheus không có target app | Kiểm tra Pod Running, label `app=devops-app`, container `api`, port name `http` và RBAC |
| Prometheus báo `forbidden` | Kiểm tra Role/RoleBinding trong `devops-app`, ServiceAccount `monitoring/prometheus` |
| Grafana `CreateContainerConfigError` | Kiểm tra Secret `grafana-admin` trong `monitoring` có đủ hai key |
| Dashboard không có request/latency | Kiểm tra target UP, tạo traffic `/` và `/missing`, đợi scrape, chọn khoảng thời gian phù hợp |
| Port-forward báo port đã được dùng | Dừng tiến trình cũ hoặc đổi cổng bên trái, ví dụ Grafana `3004:3000` rồi mở localhost:3004 |
| Port-forward mất kết nối sau rollout | Chạy lại port-forward ở terminal tương ứng |
| Pod `Pending`/`OOMKilled` | Xem Events và describe Pod, kiểm tra tài nguyên Docker Desktop và requests/limits |

Nếu muốn kiểm tra riêng cú pháp Prometheus bằng đúng image trong repo:

```sh
docker run --rm --entrypoint promtool \
  -v "$PWD/k8s/monitoring/prometheus:/etc/prometheus:ro" \
  prom/prometheus:v3.14.0 check config --syntax-only /etc/prometheus/prometheus.yml

docker run --rm --entrypoint promtool \
  -v "$PWD/k8s/monitoring/prometheus:/etc/prometheus:ro" \
  prom/prometheus:v3.14.0 check rules /etc/prometheus/alerts.yml
```

`--syntax-only` cho phép kiểm tra ngoài cluster, nơi không có ServiceAccount token. Kiểm tra này không thay thế việc xác nhận Targets UP.

## 11. Các cách chạy bổ sung

### Chạy Node.js trực tiếp, không cần cluster

```sh
npm ci
npm start
```

Ở terminal khác:

```sh
curl -fsS http://localhost:3000/
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/metrics
```

Chạy riêng như vậy chưa đưa app vào cơ chế Pod discovery của Prometheus trong cluster.

### Chạy thử Docker riêng

```sh
docker build -f dockerfile -t devops-app:standalone .
docker run --rm --name devops-app-standalone \
  -p 127.0.0.1:3001:3000 \
  -e GREETING="Hello from Docker!" \
  devops-app:standalone
```

Ở terminal khác:

```sh
curl -fsS http://localhost:3001/
curl -fsS http://localhost:3001/metrics
```

### Mở ứng dụng cho thiết bị khác qua Cloudflare tunnel

Nếu đã cài `cloudflared`, giữ port-forward ứng dụng ở mục 7 và chạy trong terminal riêng:

```sh
cloudflared tunnel --url http://127.0.0.1:3002
```

Mở URL `https://...trycloudflare.com` do lệnh in ra trên điện thoại hoặc máy khác. URL được tạo cho phiên tunnel, không hardcode URL cũ. Tunnel này cũng công khai `/metrics` vì dùng chung cổng API. Dừng bằng `Ctrl+C` khi kết thúc demo.

### Dùng image được CI publish thay cho image local

Workflow `.github/workflows/ci.yml` chạy lint → test → build/scan AMD64 và ARM64. Chỉ push lên nhánh `master` và vượt qua các bước kiểm tra mới publish image vào `ghcr.io/sangtruong-rgb/devops-app`. CI hiện chưa tự deploy vào cluster này.

Sau khi CI publish thành công một commit có `/metrics`, thay trường `image` trong `k8s/app/deployment.yaml` bằng `ghcr.io/sangtruong-rgb/devops-app:<SHA-đã-publish>`, sau đó:

```sh
kubectl --context kind-devops-two-nodes apply -f k8s/app/deployment.yaml
kubectl --context kind-devops-two-nodes -n devops-app \
  rollout status deployment/devops-app --timeout=180s
```

Đây là cách giữ image triển khai trong Git; không cần `kind load` nếu node pull được image từ registry. Nếu package private, cần cấu hình quyền pull/imagePullSecret trước.

## 12. Dừng, chạy lại và xóa lab

### Dừng truy cập tạm thời

Nhấn `Ctrl+C` ở các terminal port-forward, traffic và tunnel. App, Prometheus và Grafana vẫn chạy trong cluster. Lần sau chỉ cần kiểm tra Docker/nodes/Pods và mở lại các port-forward ở mục 7, không cần build lại nếu source không đổi.

### Tạm dừng riêng app và bật lại

```sh
kubectl --context kind-devops-two-nodes -n devops-app scale deployment/devops-app --replicas=0
```

Khi muốn bật lại:

```sh
kubectl --context kind-devops-two-nodes -n devops-app scale deployment/devops-app --replicas=2
kubectl --context kind-devops-two-nodes -n devops-app \
  rollout status deployment/devops-app --timeout=180s
```

Trong lúc app về 0 replica, rule `DevopsAppNoTargets` có thể chuyển sang firing sau khoảng 2 phút không có target. Repo có rule alert nhưng chưa triển khai Alertmanager, nên chưa gửi thông báo email/chat.

### Xóa toàn bộ cluster khi kết thúc lab

**Chỉ chạy khi muốn xóa toàn bộ tài nguyên và dữ liệu trong cluster này.** Đây không phải bước bắt buộc sau khi xem dashboard.

```sh
kind delete cluster --name devops-two-nodes
kind get clusters
```

Muốn dựng lại, làm từ mục 2; phải load lại image vào cluster mới và tạo lại Secret. Docker image trên máy không tự bị xóa cùng cluster.

## 13. Giới hạn cần nhớ khi vận hành

- Prometheus và Grafana dùng `emptyDir`, chưa có PVC. Thay/xóa Pod sẽ mất dữ liệu của Pod đó; restart container trong cùng Pod vẫn giữ volume.
- Prometheus cấu hình retention 3 ngày hoặc 512 MB TSDB; volume 1 GiB còn phục vụ WAL/head. Không xem đây là lưu trữ lịch sử lâu dài.
- Hai alert hiện có kiểm tra scrape thất bại và mất toàn bộ target, chưa kiểm tra thiếu một replica so với mong muốn.
- Chưa có node-exporter/kube-state-metrics trong repo, nên bộ dashboard hiện tại tập trung vào ứng dụng.
- Hướng dẫn thiết kế chi tiết nằm ở [Pillar 3](solo/pillar-3.md); [Pillar 2](solo/pillar-2.md) có cả lịch sử cluster cũ `devops-solo`. Các lệnh trong file này thống nhất dùng `devops-two-nodes`.
