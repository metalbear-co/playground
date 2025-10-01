FROM --platform=$BUILDPLATFORM golang:1.23-alpine as build-env

WORKDIR /app
COPY main.go ./

ARG TARGETARCH
RUN GOARCH=$TARGETARCH go build -o /main

FROM gcr.io/distroless/static-debian11

COPY --from=build-env /main /main

CMD [ "/main" ]