FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS build-env

WORKDIR /app
COPY go.mod ./
COPY go.sum ./
RUN go mod download
COPY ip-visit-counter ./ip-visit-counter
COPY protogen ./protogen
COPY proto ./proto

ARG TARGETARCH
RUN GOARCH=$TARGETARCH go build -o /main ./ip-visit-counter/main.go

FROM  gcr.io/distroless/static-debian11

COPY ./ip-visit-counter/response.txt /app/response.txt
COPY --from=build-env /main /main

CMD [ "/main" ]