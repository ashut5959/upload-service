# 🚀 Quick Start - Kubernetes Deployment

## Prerequisites
- Kubernetes cluster v1.25+
- kubectl configured
- Docker image built and pushed to registry

## Deploy in 3 Steps

### 1. Create Secrets
```bash
kubectl create secret generic upload-service-secrets \
  --from-literal=DATABASE_URL='postgresql://user:pass@host:5432/db' \
  --from-literal=REDIS_URL='redis://redis:6379' \
  --from-literal=S3_ACCESS_KEY='your-key' \
  --from-literal=S3_SECRET_KEY='your-secret' \
  --from-literal=JWT_SECRET='min-32-char-secret' \
  --from-literal=INTERNAL_SERVICE_SECRET='shared-secret' \
  -n upload-service
```

### 2. Update Image
Edit `k8s/base/kustomization.yaml`:
```yaml
images:
  - name: your-registry/upload-service
    newName: your-actual-registry/upload-service
    newTag: v1.0.0
```

### 3. Deploy
```bash
# Development
kubectl apply -k k8s/overlays/dev

# Production
kubectl apply -k k8s/overlays/production
```

## Verify
```bash
kubectl get pods -n upload-service
kubectl logs -f -l app=upload-service -n upload-service
```

## 📚 Full Documentation
See [k8s/README.md](./README.md) for complete guide.
