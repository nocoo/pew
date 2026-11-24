# Railway to jp2 Migration

Status, 2026-10-22 (Asia/Shanghai): **public cutover completed after the owner's
07:10 approval**. Public `pew.md` uses jp2, Full (strict) and shared AOP;
`DEPLOY_PHASE=production`. The temporary internal listener was removed at 07:24.
Railway's runtime was stopped at 07:44 after separate 07:40 approval; its project,
service, variables, deployment record and rollback image reference remain.
Workers, D1 schema, KV, R2 and application secrets are unchanged.
The owner explicitly waived the fresh Google login test; it is not a passed test.

## Cutover Identity and Rollback Images

This table records the accepted cutover baseline, not the latest image forever.
Subsequent releases, starting with Web v3.4.1, have their own exact-SHA CI/CD runs
and `/opt/pew/.base-ci-releases/<SHA>.json` manifests. Verify those records and
fresh public health before treating a new image as accepted. Keep the original
Railway digest and the accepted cutover image as distinct rollback references.

| Item                    | Verified value                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web / CLI versions      | Web `3.4.0`; CLI/core/Workers `3.3.3`, no npm publication or version synchronization                                                                                            |
| jp2 source              | `fcdf6e072812ed1d6cc2a1a1db31fabc92033ba4`                                                                                                                                      |
| jp2 image               | `ghcr.io/nocoo/pew@sha256:319bc5f67ca525387adff9e375d6ba93c46fa84ebbacf8a0ab592d55c5951cb1`                                                                                     |
| CI                      | [39681987929](https://github.com/nocoo/pew/actions/runs/39681987929), success                                                                                                   |
| Automatic Docker CD     | [39682620839](https://github.com/nocoo/pew/actions/runs/39682620839), success                                                                                                   |
| jp2 service             | `/opt/pew`, Compose `web`, container `pew-app`, one non-root Node process                                                                                                       |
| Application binding     | `127.0.0.1:17020` -> container 7020; external Docker network `edge`                                                                                                             |
| Runtime state           | Running/healthy, zero restarts/OOM; started `2026-10-21T21:59:31.29189512Z`                                                                                                     |
| Railway deployment      | `1f593cdc-398c-473f-a78c-9d934b019bf2`, source `6c68c6637e1e72506dcc057c03e3a8643427956a`                                                                                       |
| Railway rollback image  | `sha256:33ad82409ec299399ea54b3b13ce062d86b596303171aef800be9daf9b9c416d`                                                                                                       |
| Railway stopped runtime | Instance `c43d9a3e-c28d-404b-8c66-00a73dbab99a` and the deployment above are REMOVED; zero active deployments, `deploymentStopped=true`, `canRedeploy=true`, `canRollback=true` |

This is the first jp2 Pew deployment, so there is no earlier jp2 digest. The
accepted jp2 image above is the baseline for subsequent image rollback. Never
substitute `latest` or rebuild a rollback image. Railway must now be restored and
verified before routing traffic back. Capability flags are not a guarantee of
indefinite registry retention or proof of a future successful restore.

## Implementation and Authorization

Followed Firefly's migration/development/retrospective/handbook and inspected its
exact Docker deployment chain. The caller pins
`nocoo/base-ci/.github/workflows/deploy-docker.yml` at
`ac635753a869cb85fad1f52aae4ccbd6119f3cae`; no new release system was introduced.
Successful same-repository main push CI triggers GHCR build and digest deployment.
The shared workflow rechecks source proof and records `.base-ci-releases/<SHA>.json`.
It does not automatically roll back after failed remote verification.

- `9bd9fc8e`: remove credential build ARG/ENV pairs; restrict Docker context;
  preserve standalone/SWC/static/public assets and verify non-root native Sharp.
- `bcdffc99`: preflight, reference study and explicit approval boundaries.
- `725ef4a7`: pinned Docker CD caller, raw runtime env, bounded logs, health check,
  immutable digest/source verification, Linux container CI and regression tests.
- `e3d4c341`: private Caddy staging configuration and approved host preparation.
- `fcdf6e07`: repair the smoke-test assertion and add independent mutation controls.

All five commits were pushed through normal hooks from an env-free task clone.
Independent `max` source review approved the final code after all P0-P3 findings
were resolved. Approval of source does not itself prove deployment or OAuth.
The precutover documentation commits `ac8fe8db` and `3cb57812`, subsequent cutover
and Railway-stop records, and the Basalt 3.2.1 upgrade were held locally until the
owner requested Web v3.4.1. That release includes them through normal hooks/CI/CD;
the new digest requires its own verification rather than the cutover receipt.

At 05:24 Beijing time the owner approved removing only Railway's verified main
trigger and issuing/installing a certificate covering only `pew.md`:

- Removed trigger `1266b86e-07d4-4267-8f79-6179a58fe20a`; re-query confirmed the
  original deployment/instance and repository source unchanged. That preparation
  did not restart, redeploy, detach domains, mutate variables or stop Railway;
  the later separately approved runtime stop is recorded below.
- Transferred all 17 application variables from Railway unchanged. The private
  raw env file and running container compare equal to Railway. No values were
  printed; all 17 variable names are absent from the baked image environment.
  The 11 platform-managed `RAILWAY_*` values were omitted after checking use.
- Production mode is enforced, with no E2E flags or `NODE_OPTIONS`. Preserve the
  actual Railway memory ceiling of 8,000,000,000 bytes, not an invented 1 GiB cap.
- Deployment credentials are scoped to GitHub environment `pew / production`.
  Repository controls now use `DEPLOY_PHASE=production`, retaining
  `DEPLOY_URL=https://pew.md` and `DEPLOY_ORIGIN_MARKER=jp2`. The phase changed
  only after public acceptance. Precutover CD did not treat a public Railway
  response as new-origin acceptance.

Unlike Firefly, Pew's typed `DbRead` uses the read Worker while `DbWrite` still
uses D1 REST. Runtime `CF_D1_API_TOKEN` remains required. Google/Auth.js,
`NEXTAUTH_URL`, Worker URLs/secrets and R2 values retain their original values.
Accounting uploads still allow 24 MiB; no smaller shared-proxy limit was added.

## Origin TLS and Ingress

Certificate SAN is **exactly `pew.md`**, valid until 2041-10-17. The public
certificate is `/opt/proxy/certs/pew-origin.pem`; the private key is
`/opt/proxy/certs/pew-origin.key`, generated on jp2, root-owned, mode 0600. Matching
public keys and certificate SAN/validity were verified; the key never left jp2.
No other certificate or local trust store was changed.

The live public route now requires and verifies client certificates against
`/etc/caddy/certs/cf-origin-pull-ca.pem`, adds `X-Pew-Origin: jp2`, and proxies to
`pew-app:7020`. There is no internal 17443 listener. Both changes used validated
inode-preserving writes and `SIGUSR1`; the shared proxy was not restarted.

### Precutover Isolation (Historical)

`deploy/Caddyfile.staging` was loaded in the existing `proxy-caddy` for private
acceptance. It remains a staging template, not the active production config:

- Public 443 for `pew.md` returned only 403, regardless of client address.
- The application used TLS port 17443 inside the Caddy container. Docker did not
  publish that port, and the host had no 17443 listener. SSH forwarded to the
  inspected Caddy edge IP and internal port for canonical-SNI/Host tests.
- Do not identify SSH traffic by Docker gateway IP: userland-proxy can collapse
  other clients to that source address. The unpublished-listener design avoids
  that assumption and does not trust forwarded headers as an access gate.
- Candidate validation preceded an inode-preserving file write and `SIGUSR1`.
  Loaded autosave configuration confirms both listeners. Proxy start time stayed
  `2026-10-21T05:50:17.30329842Z`; no proxy restart occurred.
- External IPv4 with normal Origin CA/hostname verification received 403.
  The host has no public global IPv6 address (only a Tailscale ULA); external
  Internet IPv6 was not exercised. Non-publication of 17443 is verified for
  both protocols; the public denial has no IP-family condition.
- All seven other sites retain their baseline 200 or normal 307 responses:
  neo, manifest, admin.tongji, bbs.tongji, bbs2.tongji, pass and lizheng.blog.

These precutover checks alone proved private TLS/routing, not Cloudflare-to-jp2
AOP. The later public acceptance and client-certificate rejection are recorded
in the public cutover receipt below.

## Verification Receipt

| Check                      | Result                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local L1 and CI            | 4,486 tests; strict types/lint/AST gates; four coverage metrics 98.15 / 95.38 / 98.39 / 99.09                                                                                                              |
| Normal pre-push            | 101 real API cases, 97 browser cases, OSV and gitleaks passed; no hooks bypassed                                                                                                                           |
| CLI isolated E2E           | 2 files, 13 tests passed; no production credentials/state used                                                                                                                                             |
| Canonical Linux image CI   | Actual tracked Dockerfile built without application credentials; native/startup smoke passed                                                                                                               |
| Runtime identity           | Container reference, resolved image ID, OCI revision/source and release manifest agree                                                                                                                     |
| Database                   | Direct jp2 `/api/live`: 200, no-store, component `dashboard`, version 3.4.0, `database.connected=true`, `X-Pew-Origin: jp2`; authenticated read Worker ping and real data reads pass                       |
| Real data reads            | Private leaderboard API contains real entries; no redirect to Railway                                                                                                                                      |
| Pages/assets               | `/`, `/login`, `/privacy`, static PNG and actual Next image optimization pass on jp2                                                                                                                       |
| Authorization failures     | All four unauthenticated ingest routes return 401; `/leaderboard` redirects to canonical login                                                                                                             |
| Google configuration       | Provider callback remains `https://pew.md/api/auth/callback/google`                                                                                                                                        |
| Fresh Google OAuth/session | **Waived by owner**, not executed or claimed as passed; temporary browser profile removed                                                                                                                  |
| Precutover CLI upload      | Approved exact private-origin script executed with exit 0: actual CLI uploader submitted one genuine incremental bucket in one batch, HTTP 200; D1 REST parameterized readback equals the submitted bucket |

The operational script received independent `max` APPROVE at SHA256
`947e13eeba2a2654fb04d9c3134809dfd098218ab1b993faaa3c7a8938faca80`;
its hash was checked before execution. The real state lock covered the entire
operation. With no existing eligible dirty bucket, an isolated collector copied
the complete current baseline and read fresh Codex log increments. Guards rejected
schema upgrades, replay/full rescans, lost baselines and non-incremental results
before POST. The actual uploader used strict TLS through the private jp2 listener,
not the public Railway origin; the CLI bearer callback retained its token without
following the redirect. Original cursor/queue/config and side-queue bytes remained
unchanged, temporary state was removed, and the real lock was released. No reset,
queue clearing, synthetic usage or historical D1 replay was performed.

Database verification covers two independent connections: web reads through the
unchanged read Worker, and a parameterized SELECT using the running jp2 container's
original D1 REST credentials after the real web -> ingest Worker -> D1 upload.
The latter confirms the submitted bucket reached the same production database
addressed by those runtime credentials. This is not a test of every `DbWrite`
method or Google session creation, and the real upload is a committed usage write,
not a reversible probe.

The extra read-only HTTP wrapper initially asserted 200 for `/leaderboard`.
The actual protected route correctly returns 307 to the canonical login page.
The assertion was corrected to check that contract, and the complete private
read check passed. This was not a database failure or failed CLI E2E run.
`test:e2e:cli` exited successfully with all 13 tests passing; its non-fatal Vite
future-native-config-loader warning is not a failed test. Vite supports the
Vitest toolchain here; the web application remains Next.js.

Capacity preflight found 2 CPUs, 15.56 GiB RAM, about 13 GiB available and 45 GiB
root disk free. A post-start Pew sample used about 66 MiB; this is an instantaneous
observation, not a concurrency/image-processing stress-test certification.

## Approved Cutover Procedure

The owner approved this exact procedure at 07:10 Beijing time on 2026-10-22.
It has been executed; results follow the checklist. The 07:10 approval did not
include Railway lifecycle changes. A separate 07:40 approval covered only the
runtime stop recorded below; project/service deletion is still not authorized.

### Records and Settings

| Field                             | Before cutover                     | Current production state                                                                   |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| DNS record ID                     | `4302e3370f3de070a1a164c2a78972c4` | Same record                                                                                |
| DNS name / type                   | `pew.md` / CNAME                   | Unchanged                                                                                  |
| CNAME target                      | `ry32rpn0.up.railway.app`          | `jp2.nocoo.cloud`                                                                          |
| Proxy / TTL                       | Proxied / auto (`1`)               | Unchanged                                                                                  |
| Zone SSL setting                  | `ssl=full`                         | `ssl=strict`                                                                               |
| Shared Cloudflare AOP             | `tls_client_auth=off`              | `tls_client_auth=on`                                                                       |
| Custom-certificate zone-level AOP | `enabled=false`                    | Keep false; do not substitute this API toggle for shared AOP                               |
| Public Pew Caddy route            | Deny only                          | Require/verify the existing shared Cloudflare origin-pull CA, then proxy to `pew-app:7020` |

Leave MX, SPF, DKIM, DMARC and both `_railway-verify` TXT records unchanged. Leave
other Caddy hosts, certificates, Docker services and Cloudflare resources alone.
Only `pew.md` is currently proxied in this zone; recheck that inventory before
changing the zone-wide TLS/AOP settings.
The retained Railway origin also passed direct canonical-host TLS validation
with normal public CA checking; changing to strict mode need not rely on a guess
about its certificate.

### Executed Order

1. Capture fresh DNS/TLS/AOP/Caddy before-images, both deployment identities,
   current/previous accepted digests and runtime equality. Confirm Railway is
   still healthy/RUNNING and its main trigger stays removed. Prefer a quiet
   write window; do not reset clients or clear queues to obtain one.
2. Reconcile/warm only Pew's staging cache as needed. Keep one jp2 app instance.
   A private app cold start must not restart the shared proxy or Railway.
3. Set the zone to Full (strict) and enable **shared** AOP using
   `tls_client_auth=on`, retaining custom-certificate AOP disabled. Verify the
   still-Railway public site remains healthy before proceeding.
4. Replace only Pew's public-denial Caddy block with the existing Firefly pattern:
   the dedicated Pew certificate, `client_auth` mode `require_and_verify`,
   `trust_pool file` pointing to `/etc/caddy/certs/cf-origin-pull-ca.pem`,
   `X-Pew-Origin: jp2`, and `reverse_proxy pew-app:7020`. Validate the candidate,
   compare against the expected active config, preserve the bind-mount inode and
   send `SIGUSR1`. Verify loaded config, unchanged proxy start time and other
   sites. Do not relax client authentication to work around a failed handshake.
5. Change only the apex CNAME target in the table. This is the actual public
   cutover, not the earlier certificate installation or private-container start.
6. Run the public acceptance checklist. On failure follow routing rollback below;
   a successful settings API response is not a successful ingress test.
7. Only after public acceptance, set `DEPLOY_PHASE=production`, retaining canonical
   URL and jp2 marker. Remove the temporary internal Caddy listener with another
   validated hot reload. Retain Railway and rollback receipts; its shutdown or
   deletion requires separate owner authorization.

### Public Acceptance Checklist

- [x] Public no-store `/api/live` proves jp2 marker, 3.4.0 and connected D1;
      container digest/revision still match the accepted receipt.
- [x] Cloudflare reaches jp2 with strict server validation and required shared
      client authentication; unauthenticated direct public-origin requests fail.
- [x] Homepage, leaderboard data, images and normal authorization redirects work.
- [x] CLI authentication/upload behavior and preserved runtime values remain valid;
      no queue reset, synthetic production data or duplicate accounting.
- [x] Existing monitoring observes the real public endpoint healthy; no fake
      heartbeats or monitor-target changes.
- [x] Other Caddy sites and proxy start time remain unchanged.
- [x] Strict HTTPS to both real public A records and both global AAAA records
      returns jp2, 3.4.0 and connected D1, including after internal-listener removal.
- Fresh Google OAuth is owner-waived. Existing-session survival has not been
  independently demonstrated and must not be silently included in a green claim.

## Public Cutover Receipt

- Fresh DNS/TLS/AOP/Railway before-images matched the previous handoff. All 17
  runtime application variables again compared equal to Railway without printing
  their values. The full Caddy before-image matched the previously applied file.
- Enabled `ssl=strict` and shared `tls_client_auth=on`, leaving custom AOP false;
  the still-Railway public endpoint and direct canonical Railway TLS remained
  healthy. Replaced only Pew's public denial block with required shared-client
  authentication, validated and hot-reloaded it, then changed only the apex
  CNAME content. Every other DNS record and all other apex fields except the
  expected modification timestamp compared unchanged.
- Verified loaded Caddy configuration, unchanged start time and direct-origin
  rejection with `ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED` while validating the
  server's CA/hostname. Public responses carry both `X-Pew-Origin: jp2` and
  `CF-Ray`. Headers alone are not the AOP proof.
- Public read checks passed for `/`, `/login`, `/privacy`, protected leaderboard
  redirect, real leaderboard API data, static PNG and Next image optimization.
  All four unauthenticated ingest routes still return 401. The seven other sites
  retained their baseline 200/307 responses after both hot reloads.
- Independent `max` review approved the public uploader at SHA256
  `f0200005cdce4c421f7c76659f62d0755cafcda2d94fe070f254fd705b6fb0e2`.
  Its hash matched before the single execution: exit 0, one genuine pending
  incremental bucket, one batch, HTTP 200, exact D1 REST readback, preserved CLI
  bearer callback and unchanged real state bytes. Real locks and temporary state
  were cleaned. This may be the same server bucket as the earlier private probe;
  it is not claimed to be a different bucket or a reversible production write.
- The system resolver initially returned a synthetic IPv4-mapped address for
  `curl -6`; that is not native IPv6 evidence. Strict HTTPS forced to the real
  global AAAA addresses `2606:4700:3037::ac43:b051` and
  `2606:4700:3037::6815:5867` passed, as did both real A addresses. These are
  observed Cloudflare edge addresses, not permanent deployment configuration.
  jp2 itself still has no global IPv6 address; public IPv6 terminates at Cloudflare.
- Kuma's existing `/api/live` monitor reported up with valid public TLS. Hexly's
  real post-cutover scheduled observation at 07:20:39 Beijing time reported
  operational, HTTP 200, version 3.4.0. No monitor configuration or heartbeat was
  changed or manufactured.
- After these gates, set only `DEPLOY_PHASE=production`, validated and removed
  the temporary internal Pew block, and hot-reloaded again. Loaded config and
  container TCP/TCP6 tables confirm 17443 is no longer listening. Repeated all
  four real-address public health checks and the seven-site comparison after
  removal. App/source/digest stayed unchanged; shared Caddy's start time remains
  `2026-10-21T05:50:17.30329842Z`.

All required acceptance gates passed and no routing rollback was invoked. These
bounded probes do not establish zero interruption or a load-test guarantee.

## Railway Runtime Stopped

At 07:40 Beijing time the owner approved stopping Pew's Railway runtime without
deleting its project, service, variables, image reference or deployment record.
Before stopping, fresh public health proved jp2, HTTP 200, version 3.4.0 and
connected D1. Both latest and active Railway deployment IDs matched the retained
deployment and exact rollback digest above; its main trigger was still absent.

Used Firefly's verified `railway down` approach, explicitly scoping project
`5355f331-824a-4679-9c13-930d42de8306`, service
`271ef038-2d88-431e-915e-c721fbdf7922` and environment
`72cb9637-87fa-41e7-bf5b-c6b1ae00bf3d`. This removes the runtime, not those resources.
At 07:44, re-query confirmed zero active deployments, the old instance/deployment
status REMOVED, `deploymentStopped=true`, and both restore capability flags true.
The original deployment remains queryable with its exact image digest. All 17
application variables compared equal in memory before/after; values were not
printed or stored in the receipt. Project/service/source and the absent trigger
were also preserved. No replica configuration or image rebuild was introduced.

After stopping, public health remained jp2/200/3.4.0 with connected D1. A strict-TLS
CLI bearer check returned its expected 307 callback, preserved the existing token
and did not follow the redirect. Unauthenticated ingest remained 401. Real config
bytes stayed unchanged and the temporary CLI lock was released. This post-stop
check did not upload usage; the earlier real public upload remains the write-path
receipt and is not relabeled as a new post-stop write. No jp2, DNS, TLS/AOP, Worker
or shared-Caddy configuration changed during the stop.

Scoped before/after records and sanitized `stop-receipt.json` and `cli-health.json`
are retained at `/opt/pew/railway-stop-20261022T0740/`, with matching transfer
checksums. No restore was executed merely to test rollback.

## Rollback Procedure

The current public deployment uses the post-DNS branch below if rollback becomes
necessary. The pre-DNS branch remains for an approved future attempt starting
from an already restored and verified Railway origin; no rollback is currently
needed.

If an approved attempt fails before changing the apex CNAME, including a failed
or partially successful TLS/AOP update in step 3:

1. Restore the TLS/AOP settings changed by that attempt to their captured values
   (`ssl=full`, `tls_client_auth=off`; custom AOP remains false). Do not require
   public Railway health before restoring settings that may have caused its
   failure. DNS still points to Railway; no DNS change or propagation wait is
   needed.
2. Recheck the original public Railway endpoint and its deployment identity after
   restoring the settings. If it remains unhealthy, stop and diagnose; do not
   restart, redeploy or stop Railway.
3. If Pew's public Caddy block was already changed, restore only its deny/private
   configuration with validation and `SIGUSR1`. Keep `DEPLOY_PHASE=precutover`.
   Do not restart shared Caddy or alter other sites.

If the apex CNAME has been changed to jp2, including a later monitoring failure
after `DEPLOY_PHASE` was set to `production`:

1. Restore Railway first if it is still stopped, using the recovery procedure
   below. Require a running instance, the retained digest, connected D1 and normal
   canonical Host/SNI TLS validation before changing DNS. If Railway is already
   running and healthy, do not redeploy it unnecessarily.
2. Restore only the apex CNAME to `ry32rpn0.up.railway.app`, preserving proxy/TTL.
   Initially retain strict/shared-AOP settings while traffic returns: the old
   Railway certificate was verified, and prematurely disabling AOP could break
   requests still reaching jp2's require-and-verify listener.
3. Verify public Railway identity/health and allow routing propagation before
   restoring captured original settings (`ssl=full`, `tls_client_auth=off`, custom
   AOP false) as needed. Keep shared AOP enabled while requests may still reach
   jp2's require-and-verify listener. Restore only
   Pew's deny/private Caddy blocks with validation and `SIGUSR1`; never restore
   unrelated historical routes wholesale or restart the proxy.
4. Restore `DEPLOY_PHASE=precutover` before allowing any subsequent release,
   retaining `DEPLOY_URL=https://pew.md` and `DEPLOY_ORIGIN_MARKER=jp2`. Otherwise
   the next CD would replace the jp2 container and then incorrectly require a
   public jp2 marker from Railway; that workflow has no automatic rollback.
5. Check database-backed reads and intended public authentication before resuming
   normal writes. Keep the other origin private. Do not claim zero interruption
   from sparse probes or assume routing rollback reverses database writes.

### Restore the Stopped Railway Deployment

Only during an authorized recovery, query retained deployment
`1f593cdc-398c-473f-a78c-9d934b019bf2` and confirm `canRedeploy` and its recorded
image digest. Use the inspected Railway GraphQL operation, as in Firefly:

```graphql
mutation {
  deploymentRedeploy(id: "1f593cdc-398c-473f-a78c-9d934b019bf2", usePreviousImageTag: true) {
    id
  }
}
```

Record the returned deployment ID and poll that deployment, not just the mutation
acknowledgment. Require a RUNNING instance, `deploymentStopped=false` and image
digest `sha256:33ad82409ec299399ea54b3b13ce062d86b596303171aef800be9daf9b9c416d`.
Verify retained application variables and the canonical domain attachment, then
request `https://pew.md/api/live` through
`--connect-to pew.md:443:ry32rpn0.up.railway.app:443` with normal CA checking.
Require 200, version 3.4.0 and connected D1 before proceeding to routing rollback.
Keep DNS on jp2 while restoring; do not enable Railway's main trigger, use
`railway up`, rebuild current source, select `latest` or weaken TLS to force a
passing result. If the old image has expired or restoration fails, stop and report
the blocker rather than silently substituting another image. The flags observed
at stop time do not certify future restoration or the platform's retention period.

### Image-only Rollback on jp2

For image rollback, use an accepted `ghcr.io/nocoo/pew@sha256:...` reference and
its full source SHA with the same raw runtime env. Compose still requires
`IMAGE_SHA` even when a digest override is supplied. Pull that digest and replace
only `web` with `--no-deps`; verify image identity, health and database afterward.
The shared workflow has no automatic rollback. No schema/data migration is part
of this task; do not restore a database snapshot to roll back application hosting.
An image-only rollback that keeps the public origin on jp2 retains
`DEPLOY_PHASE=production`; it must not use the routing-rollback phase change.

## Receipts and Remaining Work

`/opt/pew/railway-rollback.json` holds Railway before-images.
`/opt/pew/precutover-20261022/` holds DNS, SSL/AOP, Caddy and certificate receipts.
`/opt/pew/.base-ci-releases/fcdf6e072812ed1d6cc2a1a1db31fabc92033ba4.json` proves
the deployed digest. Runtime values remain only in private `.env.runtime` and
container configuration, never in this runbook or build inputs.

Precutover read-only checks at 06:30 Beijing time reconfirmed the same jp2 digest and
healthy container with zero restarts/OOM, connected database on jp2 and Railway,
the unchanged Railway deployment/instance with no repository trigger, and exact
equality of DNS/SSL/shared-AOP/custom-AOP before-images. At that point public jp2
443 returned 403, port 17443 was unpublished, shared Caddy's start time was unchanged,
and all seven other sites retained their baseline responses. The sanitized
`final-acceptance.json` and `real-cli-acceptance.json` receipts are retained in the
host's precutover directory; neither contains credentials or source records.

Cutover before-images and the sanitized `cutover-complete.json`, public CLI,
native IPv6 and post-cleanup receipts are in `/opt/pew/cutover-20261022T0710/`.
The completion receipt was copied with a matching SHA256 and mode 0600. The
image accepted by that operation was the `fcdf6e07` digest recorded above. The
cutover itself did not build an image, push commits, publish npm or change versions.

Keep `DEPLOY_PHASE=production`, strict/shared AOP and Railway stopped with its
recovery resources retained. Each later release requires normal hooks and a new
CI/CD deployment. Recheck the exact new SHA,
GHCR digest, public origin/version/database and retained rollback image afterward;
the current image receipt cannot certify a future rebuild. Railway project/service
deletion and fresh Google login testing remain outside this operation's scope.
