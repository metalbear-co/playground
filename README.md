# MetalBear Playground

This repository contains different microservices and Kubernetes manifests to deploy them.
Each microservice has it's own `app.yaml` that should contain all of it's dependencies (besides other microservices).

To deploy on GKE, run:
```
kustomize build --enable-helm overlays/gke | kubectl apply -f -
```

To deploy on **EKS**, run:
```
kustomize build --enable-helm overlays/eks | kubectl apply -f -
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

For a local setup without SQS, run:
```
kubectl apply -k overlays/local
```

For a local setup with SQS (localstack) run:
```
kubectl kustomize --enable-helm overlays/localstack | kubectl apply -f -
```
This requires having helm installed.

To use SQS splitting, it should be enabled on operator installation.
When enabling SQS splitting in the installation, you are required to
specify an ARN of an AWS role. When working with localstack, that flag
is still required, but it doesn't really matter what ARN you provide,
so you can use e.g.
`--aws-role-arn=arn:aws:iam::526936346960:role/mirrord-operator-dummy-role`.

Then patch the mirrord operator to use localstack for SQS:
```bash
kubectl patch deployment mirrord-operator -n mirrord --patch-file overlays/localstack/localstack-env-vars-patch.yaml --type json
```