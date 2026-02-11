# Kubernetes Deployment Guide - Upload Service

This directory contains all Kubernetes manifests for deploying the upload service in a production environment.

## 📁 Directory Structure

```
k8s/
├── base/                          # Base Kubernetes resources
│   ├── namespace.yaml             # Dedicated namespace
│   ├── serviceaccount.yaml        # Service account for pods
│   ├── configmap.yaml             # Non-sensitive configuration
│   ├── secret.yaml.template       # Template for secrets (DO NOT COMMIT)
│   ├── deployment.yaml            # Main deployment with health checks
│   ├── service.yaml               # ClusterIP service
│   ├── hpa.yaml                   # Horizontal Pod Autoscaler
│   ├── network-policy.yaml        # Network security policy
│   └── kustomization.yaml         # Base kustomization
├── overlays/
│   ├── dev/                       # Development environment
│   │   ├── kustomization.yaml
│   │   └── deployment-patch.yaml
│   └── production/                # Production environment
│       └── kustomization.yaml
└── README.md                      # This file
```

## 🚀 Quick Start

### Prerequisites

1. **Kubernetes Cluster** (v1.25+)
2. **kubectl** installed and configured
3. **Kustomize** (or kubectl v1.14+ with built-in kustomize)
4. **Container Registry** access (replace `your-registry/upload-service` in manifests)
5. **External Dependencies**:
   - PostgreSQL database
   - Redis cache
   - S3-compatible storage

### Step 1: Build and Push Docker Image

```bash
# Build the image
docker build -t your-registry/upload-service:v1.0.0 .

# Push to registry
docker push your-registry/upload-service:v1.0.0
```

### Step 2: Update Image References

Edit `k8s/base/kustomization.yaml` and update:
```yaml
images:
  - name: your-registry/upload-service
    newName: your-actual-registry/upload-service
    newTag: v1.0.0
```

### Step 3: Create Secrets

**⚠️ CRITICAL: Never commit actual secrets to version control!**

#### Option A: Create from literal values

```bash
kubectl create secret generic upload-service-secrets \
  --from-literal=DATABASE_URL='postgresql://user:pass@host:5432/db' \
  --from-literal=REDIS_URL='redis://redis-host:6379' \
  --from-literal=S3_ACCESS_KEY='your-access-key' \
  --from-literal=S3_SECRET_KEY='your-secret-key' \
  --from-literal=JWT_SECRET='your-jwt-secret-min-32-chars' \
  --from-literal=INTERNAL_SERVICE_SECRET='your-internal-secret' \
  --from-literal=JWT_ISSUER='api-gateway' \
  -n upload-service
```

#### Option B: Create from environment file

```bash
# 1. Copy example file
cp .env.k8s.example .env.k8s.production

# 2. Edit .env.k8s.production with actual values
nano .env.k8s.production

# 3. Create secret from file
kubectl create secret generic upload-service-secrets \
  --from-env-file=.env.k8s.production \
  -n upload-service

# 4. DELETE the .env file after creating secret
rm .env.k8s.production
```

### Step 4: Deploy Using Kustomize

#### Development Environment

```bash
# Preview what will be deployed
kubectl kustomize k8s/overlays/dev

# Apply to cluster
kubectl apply -k k8s/overlays/dev
```

#### Production Environment

```bash
# Preview
kubectl kustomize k8s/overlays/production

# Apply
kubectl apply -k k8s/overlays/production
```

#### Base Deployment (manual)

```bash
# Create namespace first
kubectl apply -f k8s/base/namespace.yaml

# Then apply all resources
kubectl apply -k k8s/base
```

## 📊 Verify Deployment

### Check Resources

```bash
# Check all resources in namespace
kubectl get all -n upload-service

# Check pods
kubectl get pods -n upload-service

# Check deployment status
kubectl rollout status deployment/upload-service -n upload-service

# Check HPA status
kubectl get hpa -n upload-service
```

### View Logs

```bash
# Tail logs from all pods
kubectl logs -f -l app=upload-service -n upload-service

# Logs from specific pod
kubectl logs -f <pod-name> -n upload-service

# Previous pod logs (if crashed)
kubectl logs --previous <pod-name> -n upload-service
```

### Health Checks

```bash
# Port-forward to test locally
kubectl port-forward -n upload-service svc/upload-service 3000:3000

# Test health endpoint
curl http://localhost:3000/health

# Test ready endpoint
curl http://localhost:3000/ready

# Test metrics
curl http://localhost:3000/metrics
```

## 🔧 Configuration

### Environment Variables

**Managed via ConfigMap** (`configmap.yaml`):
- `NODE_ENV`
- `PORT`
- `LOG_LEVEL`
- `S3_REGION`, `S3_ENDPOINT`, `S3_BUCKET`
- `MAX_FILE_SIZE`
- `ALLOWED_FILE_TYPES`

**Managed via Secret** (`upload-service-secrets`):
- `DATABASE_URL`
- `REDIS_URL`
- `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `JWT_SECRET`, `JWT_ISSUER`
- `INTERNAL_SERVICE_SECRET`

### Update Configuration

```bash
# Update ConfigMap
kubectl edit configmap upload-service-config -n upload-service

# Restart pods to pick up changes
kubectl rollout restart deployment/upload-service -n upload-service
```

### Update Secrets

```bash
# Decode existing secret
kubectl get secret upload-service-secrets -n upload-service -o yaml

# Update secret
kubectl create secret generic upload-service-secrets \
  --from-literal=KEY=new-value \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart deployment
kubectl rollout restart deployment/upload-service -n upload-service
```

## 📈 Scaling

### Manual Scaling

```bash
# Scale to 5 replicas
kubectl scale deployment upload-service --replicas=5 -n upload-service
```

### Autoscaling (HPA)

The HPA is configured to scale between 2-10 replicas based on:
- **CPU**: Target 70% utilization
- **Memory**: Target 80% utilization

```bash
# View HPA status
kubectl get hpa upload-service-hpa -n upload-service

# Describe HPA for details
kubectl describe hpa upload-service-hpa -n upload-service
```

## 🔄 Updates and Rollbacks

### Rolling Update

```bash
# Update image version in kustomization.yaml, then:
kubectl apply -k k8s/overlays/production

# Watch rollout
kubectl rollout status deployment/upload-service -n upload-service
```

### Rollback

```bash
# View rollout history
kubectl rollout history deployment/upload-service -n upload-service

# Rollback to previous version
kubectl rollout undo deployment/upload-service -n upload-service

# Rollback to specific revision
kubectl rollout undo deployment/upload-service --to-revision=2 -n upload-service
```

## 🐛 Troubleshooting

### Pods not starting

```bash
# Check pod events
kubectl describe pod <pod-name> -n upload-service

# Check logs
kubectl logs <pod-name> -n upload-service

# Execute into pod
kubectl exec -it <pod-name> -n upload-service -- /bin/sh
```

### Database connection issues

```bash
# Test DNS resolution
kubectl exec -it <pod-name> -n upload-service -- nslookup postgres-host

# Verify secret values
kubectl get secret upload-service-secrets -n upload-service -o json | jq '.data | map_values(@base64d)'
```

### Resource constraints

```bash
# Check resource usage
kubectl top pods -n upload-service

# Describe pod for resource limits
kubectl describe pod <pod-name> -n upload-service
```

### Network policy issues

```bash
# Check network policies
kubectl get networkpolicies -n upload-service

# Describe network policy
kubectl describe networkpolicy upload-service-netpol -n upload-service
```

## 🗑️ Cleanup

### Delete Deployment

```bash
# Delete using kustomize
kubectl delete -k k8s/overlays/production

# Or delete namespace (removes everything)
kubectl delete namespace upload-service
```

## 🔐 Security Considerations

1. **Secrets Management**:
   - Use external secret managers (e.g., AWS Secrets Manager, HashiCorp Vault)
   - Rotate secrets regularly
   - Never commit secrets to Git

2. **Network Policies**:
   - Review and adjust `network-policy.yaml` based on your cluster setup
   - Ensure only authorized services can communicate

3. **RBAC**:
   - Service account has minimal permissions
   - Add RBAC rules if service needs cluster access

4. **Security Context**:
   - Runs as non-root user (UID 1001)
   - Read-only root filesystem where possible
   - Drops all capabilities

5. **Image Security**:
   - Use specific image tags (not `latest`)
   - Scan images for vulnerabilities
   - Use private registry with authentication

## 📚 Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Kustomize Documentation](https://kustomize.io/)
- [HPA Documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)

## 🆘 Support

For issues or questions:
1. Check pod logs: `kubectl logs -l app=upload-service -n upload-service`
2. Review events: `kubectl get events -n upload-service --sort-by='.lastTimestamp'`
3. Contact DevOps team

---

**Last Updated**: 2026-02-11
**Version**: 1.0.0
