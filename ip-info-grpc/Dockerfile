FROM --platform=$BUILDPLATFORM golang:1.23-alpine as build-env

WORKDIR /app
COPY go.mod ./
COPY go.sum ./
RUN go mod download
COPY ip-info-grpc ./ip-info-grpc
COPY protogen ./protogen
COPY proto ./proto

RUN GOARCH=$TARGETARCH go build -o /main ./ip-info-grpc/main.go

FROM gcr.io/distroless/static-debian11

COPY --from=build-env /main /main

CMD [ "/main" ]