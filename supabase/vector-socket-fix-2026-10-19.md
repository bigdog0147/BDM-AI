# Vector container socket fix (2026-10-19)

## What happened
The local Supabase stack in this repo was found to depend on Docker Desktop's
historically-exposed TCP API: `supabase_vector_BDM-AI` ran with
`DOCKER_HOST=http://host.docker.internal:2375`. When TCP/2375 was disabled for
security on 2026-10-19 (Docker Desktop `ExposeDockerAPIOnTCP2375=false`, now
active), vector crash-looped ("Network unreachable" on every boot).

## Current state (working fix, container-level)
The running vector container was recreated with identical settings except:
- `DOCKER_HOST=unix:///var/run/docker.sock`
- bind mount `/var/run/docker.sock:/var/run/docker.sock`
Original spec archived at `E:\AI\WorkstationSetup\backups\vector-container-spec.json`.

## If you run `supabase stop` / `supabase start` again
The Supabase CLI (2.117.0) regenerates the stack definition and may reintroduce
the TCP 2375 `DOCKER_HOST`, which now returns "Network unreachable" inside
vector while the host security setting remains off (correct behavior).

### Recovery (verified working, ~1 minute)
If `supabase_vector_BDM-AI` shows `Restarting (0)` after a stack rebuild:
1. Confirm desired end state: daemon exposure stays OFF
   (`Get-NetTCPConnection -LocalPort 2375 -State Listen` must return nothing)
2. Re-run the faithful recreation helper:
   `pwsh -File E:\AI\WorkstationSetup\scripts\recreate-vector.ps1`
   (it snapshots current specs to the fallback archive, then recreates the
   container with the socket-mount env swap)
3. Verify: `docker ps` shows vector `Up (healthy)` and its logs end with
   "Started watching for container logs"

### Durable alternative (project decision)
Make the stack definition itself socket-based so no recovery step is ever
needed — e.g., a post-`supabase start` hook executing
`recreate-vector.ps1`, or a read-only Docker socket proxy replacing port 2375.
Requires editing this repo's start workflow; do it with explicit approval and
keep BDM-AI's git history clean.
