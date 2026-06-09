# Seat broker container (Cloud Run). seats.json is baked in; claims persist to /tmp (writable).
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 go build -o /broker .

FROM gcr.io/distroless/static-debian12
COPY --from=build /broker /broker
# seats.json is mounted from a Secret in-cluster (SEATS_FILE set by the chart); not baked in.
ENV CLAIMS_FILE=/tmp/claims.json
ENTRYPOINT ["/broker"]
