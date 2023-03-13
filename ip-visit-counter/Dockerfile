FROM --platform=$BUILDPLATFORM golang:1.20-alpine as build-env

WORKDIR /app
COPY go.mod ./
COPY go.sum ./
RUN go mod download
COPY *.go ./

RUN GOARCH=$TARGETARCH go build -o /main

FROM gcr.io/distroless/static-debian11

COPY response.txt /app/response.txt
COPY --from=build-env /main /main

CMD [ "/main" ]