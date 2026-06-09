# Run of show — MetalMart mirrord workshop

~60 min hands-on after a 5-min slide intro. Up to 50 attendees, app devs, macOS + WSL2.

## Facilitator pre-flight (the day before + 30 min before)

- [ ] Cluster up (`scripts/bootstrap-cluster.sh`), Operator healthy: `kubectl get pods -n mirrord`.
- [ ] DNS A-record for the host resolves; **ManagedCertificate Active** (check hours ahead).
- [ ] All seats ready: each attendee namespace has a `frontend` + `inventory-service` pod (`kubectl get pods -n ws-a01`).
- [ ] In-cluster broker healthy (`kubectl get pod -n workshop-shared -l app=broker`); landing page
      loads at `https://<host>/` and `/api/claim` works.
- [ ] Smoke test one seat end-to-end on a clean machine (both paths): companion `workshop start`,
      AND the manual path (claim on the page → download files → `mirrord exec … sh reload.sh …`).
- [ ] **Load check:** run ~50 scripted steals; watch Operator + node pressure (`kubectl top nodes`).

- [ ] **The only thing to hand out is the URL: `https://<host>/`.** Project it. Three ways in:
      (A) companion one-liner, (B) manual no-binary path on the page, (C) can't install anything →
      watch you drive it on screen.

## Timeline

| Time | Step | What attendees do | Watch for |
|----:|------|-------------------|-----------|
| 0:00 | **Intro** (slides) | open `https://<host>/` — pick a path (companion / manual / watch) | no pre-email; the page IS the instructions |
| 0:05 | **Set up** | `workshop start` (or the manual web path) → writes ~/mirrord-workshop + prints the commands | install storm; locked-down folks just watch your screen |
| 0:12 | **See the architecture** | `kubectl get pods` → a **frontend** + **backend** pod; `cat mirrord.json` | this is the moment they "get" it |
| 0:20 | **First steal** | run `mirrord exec -f mirrord.json -- …` themselves → open URL → **banner flips to their laptop** | they run mirrord; watch the agent spin up. Celebrate the banner |
| 0:30 | **The edit loop** | set `PREFIX = "🔥 "` on the `👇 EDIT ME` line → save → refresh → products change in the cloud | hot-reloads in ~seconds (`↻ reloading` in their terminal) |
| 0:40 | **It just works** | env/DNS/outgoing: Node read the cluster DB with zero local setup; laptop runs Python while the pod runs Node | reinforce language-agnostic |
| 0:50 | **IDE + wrap** | (demo) one-click from VS Code + breakpoint hit by cluster traffic; where to go next | leave them wanting the Operator |

## Failure playbook

- **Page won't load / 5xx after steal:** their local backend died or the session dropped.
  → Ctrl-C in the terminal, re-run the `mirrord exec` command, refresh.
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
