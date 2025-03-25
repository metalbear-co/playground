# MetalBear Playground

This repository contains different microservices and Kubernetes manifests to deploy them.
Each microservice has it's own `app.yaml` that should contain all of it's dependencies (besides other microservices).

To deploy on GKE, run:
```
kubectl apply -k overlays/gke
```


## SQS

To enable SQS:

1. Install mirrord Operator in cluster (with SQS splitting enabled)
2. `aws iam create-user --user-name SQSPlayground`
3. `aws iam create-access-key --user-name SQSPlayground` - save data to file
4. `aws sqs create-queue --queue-name IpCount` - take QueueUrl to be used in deployment.yaml
5. You need to edit `ip-visit-sqs-consumer/policy.json` and set REGION and ACCOUNT_ID
6. `aws iam create-policy --policy-name SQSPlaygroundPolicy --policy-document file://ip-visit-sqs-consumer/policy.json`
7. `aws iam attach-user-policy --policy-arn arn:aws:iam::526936346962:policy/SQSPlaygroundPolicy --user-name SQSPlayground`
8. Set Region in app.yaml in `ip-visit-counter` and `ip-visit-sqs-consumer`


## Proto

To build proto

```
cd proto
protoc --go_out=../protogen --go_opt=paths=source_relative \
        --go-grpc_out=../protogen --go-grpc_opt=paths=source_relative ./ipinfo.proto
```

## Minikube/Local

```
kubectl apply -k overlays/local
```