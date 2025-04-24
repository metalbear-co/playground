FROM --platform=$BUILDPLATFORM golang:1.23-alpine as build-env

WORKDIR /app
COPY go.mod ./
COPY go.sum ./
RUN go mod download
COPY *.go ./

ARG TARGETARCH
RUN GOARCH=$TARGETARCH go build -o /main

FROM gcr.io/distroless/static-debian11

COPY --from=build-env /main /main

CMD [ "/main" ]