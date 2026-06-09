{{/*
Common labels applied to every object.
*/}}
{{- define "ws.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: mirrord-workshop
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/*
Seat number padded to two digits, given a zero-based index passed as a dict {i, root}.
Usage: {{ include "ws.seat" (dict "i" $i "root" $) }}  -> e.g. "a01"
*/}}
{{- define "ws.seat" -}}
{{- printf "%s%02d" .root.Values.seatPrefix (add .i 1) -}}
{{- end -}}

{{/*
Namespace for a seat index. Usage: {{ include "ws.ns" (dict "i" $i "root" $) }} -> "ws-a01"
*/}}
{{- define "ws.ns" -}}
{{- printf "%s%s%02d" .root.Values.namespacePrefix .root.Values.seatPrefix (add .i 1) -}}
{{- end -}}

{{/*
DATABASE_URL pointing at the shared workshop Postgres.
*/}}
{{- define "ws.databaseUrl" -}}
postgresql://{{ .Values.postgres.user }}:{{ .Values.postgres.password }}@postgres.{{ .Values.namespaces.infra }}.svc.cluster.local:5432/{{ .Values.postgres.db }}
{{- end -}}
