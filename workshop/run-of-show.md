# Run of show — MetalMart mirrord workshop

~60 min hands-on after a 5-min slide intro. Up to 50 attendees, app devs, macOS + WSL2.

## Facilitator pre-flight (the day before + 30 min before)

- [ ] Cluster up (`scripts/bootstrap-cluster.sh`), Operator healthy: `kubectl get pods -n mirrord`.
- [ ] DNS A-record for the host resolves; **ManagedCertificate Active** (check hours ahead).
- [ ] All seats ready: `kubectl get deploy -A | grep inventory | wc -l` ≈ attendees + 1 (finale).
- [ ] In-cluster broker healthy (`kubectl get pod -n workshop-shared -l app=broker`); landing page
      loads at `https://<host>/` and `/api/claim` works.
- [ ] Smoke test one seat end-to-end on a clean machine (both paths): companion `workshop start`/`run`,
      AND the manual path (claim on the page → download files → `mirrord exec … sh reload.sh …`).
- [ ] **Load check:** run ~50 scripted steals; watch Operator + node pressure (`kubectl top nodes`).
      Especially the finale 50-on-1.
- [ ] **The only thing to hand out is the URL: `https://<host>/`.** Project it. Three ways in:
      (A) companion one-liner, (B) manual no-binary path on the page, (C) can't install anything →
      watch you drive it on screen.

## Timeline

| Time | Step | What attendees do | Watch for |
|----:|------|-------------------|-----------|
| 0:00 | **Intro** (slides) | open `https://<host>/` — pick a path (companion / manual / watch) | no pre-email; the page IS the instructions |
| 0:05 | **Provision** | companion: `workshop start --install`; manual: claim on page → download → run | install storm; locked-down folks just watch your screen |
| 0:10 | **First steal** | `workshop run` → file pops open + URL → **banner flips to their laptop** (data unchanged — that's the point) | the "whoa" is the banner, not the data. Celebrate it |
| 0:17 | **The edit loop** | set `PREFIX = "🔥 "` on the `👇 EDIT ME` line → save → refresh → every product changes in the cloud | wrapper hot-reloads in ~seconds (`↻ reloading` in terminal); no restart needed |
| 0:27 | **It just works** | point out env/DNS/outgoing: Node read the cluster DB with zero local setup; your laptop runs Python while the pod runs Node | reinforce language-agnostic |
| 0:35 | **mirror vs steal + filter** | look at `mirrord-core.json`: steal + `^/products` path filter keeps probes on the pod | concept that powers the finale |
| 0:42 | **Finale** | everyone `workshop run --finale` at once → all steal ONE shared pod, each filtered by their `baggage` key | the team sell. Project the board |
| 0:54 | **IDE + wrap** | (demo) one-click from VS Code + breakpoint hit by cluster traffic; where to go next | leave them wanting the Operator |

## Failure playbook

- **Page won't load / 5xx after steal:** their local backend died or the session dropped.
  → Ctrl-C in the terminal, `workshop run` again, refresh. The UI already says this.
- **Banner never flips to laptop:** local backend isn't setting `X-Served-By`, or steal didn't
  attach. Check the terminal for mirrord errors; confirm `workshop doctor` shows mirrord + seat.
- **`no seats left`:** broker pool exhausted — bump `attendeeCount` and `helm upgrade`, re-run
  `gen-seats.sh`, restart broker. (That's why we provision a buffer.)
- **`cannot create steal lock / conflicts with session`:** a previous mirrord was force-quit and
  left a zombie session holding the lock. Facilitator (admin kubeconfig): `mirrord operator session
  kill-all`, then the attendee re-runs. Normal Ctrl-C exits cleanly (10s grace) and won't cause this.
- **Corporate laptop blocks mirrord / cluster:** pair them with a neighbor, or use the cloud IDE.
- **WSL2 attendee stuck:** everything (mirrord, runtime, edits, `workshop`) runs *inside* WSL2;
  the browser stays on Windows hitting the public URL. See the pre-work WSL2 track.
- **Whole-room network sag:** fall back to the facilitator machine on a hotspot for the live demo;
  attendees watch + edit, catch up after.
- **Reset an attendee:** `workshop reset` then `workshop start` (re-claims the same seat by name).

## Teardown (same day)

- [ ] `gcloud container clusters delete "$CLUSTER" --region "$REGION"` (SA tokens die with it).
- [ ] Stop the broker; archive `claims.json` if you want attendance.
- [ ] Confirm no leftover LBs/IPs/disks in the project.
