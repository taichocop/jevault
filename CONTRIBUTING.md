# CLI development container

Use a host terminal and the Dev Container CLI; VS Code is optional. The host
manages Docker and container lifecycle. Development commands run in Linux.
Ordinary development needs no GitHub write credential. GitHub publishing
authentication is separate work under Issue #137.

## Prerequisites and versions

Install/start a Docker-compatible Linux runtime and install the
[Dev Container CLI](https://github.com/devcontainers/cli#readme) on the host:

```sh
npm install --global @devcontainers/cli@0.89.0
docker version
devcontainer --version
```

The host CLI needs Node >=20; use a maintained Node version supported by
`package.json`. The container uses these development tools:

| Tool | Version / source |
| --- | --- |
| Node / npm | 22.23.3 / 10.9.9, official `node:22.23.3-bookworm-slim` image |
| Base image | Multi-platform digest recorded in `.devcontainer/Dockerfile` |
| Git / bubblewrap | Debian Bookworm packages; initially 2.39.5 / 0.8.0 |
| Codex CLI | 0.162.1, official npm package `@openai/codex` |
| Dev Container CLI | 0.89.0, host-only tool |

The lifecycle was exercised on macOS arm64 with Docker Desktop / Engine 29.3.1
and Linux arm64 containers. The follow-up sandbox check used the Docker VM's
`6.12.76-linuxkit` kernel; Debian Bookworm is the container userspace, not the
kernel. Host, image, Node and bubblewrap architectures were arm64, with no
cross-architecture image execution involved.
**Codex sandbox execution remains blocked on this setup.** The corrected
command below selects workspace-write, but `/usr/bin/bwrap` fails its namespace
`clone` with `EPERM` before the requested command starts. The
[matching Docker Engine default seccomp rules](https://github.com/moby/moby/blob/f78c987ad3710cacffe47fce696975ecb337148d/vendor/github.com/moby/profiles/seccomp/default_linux.go#L593-L682)
deny that clone when the capability bounding set lacks `CAP_SYS_ADMIN`, as in
this container. No security-policy exception was applied. Other possible
restrictions after namespace creation remain untested.
CLI installation and project verification alone do not establish a working
Codex development environment. Native Linux, amd64, Windows/WSL and other
runtimes are unverified. The fixed `node` UID/GID is 1000; native Linux bind
mounts must already be writable by that user. Automatic UID rewriting is
disabled to keep named-volume ownership consistent.

## Create and execute (host terminal)

Use a standalone clone with its own `.git` directory. Linked worktrees contain
external Git paths; do not mount a host parent directory to make them work.
Choose a new destination; leave existing checkouts and host dependencies alone.

```sh
git clone https://github.com/taichocop/jevault.git jevault-container
cd jevault-container
# Before merge, explicitly check out the Issue #136 PR branch here.
test -d .git
workspace="$(pwd -P)"
devcontainer up --workspace-folder "$workspace"
devcontainer exec --workspace-folder "$workspace" sh -c 'id; node --version; npm --version; git --version; codex --version'
devcontainer exec --workspace-folder "$workspace" npm ci
devcontainer exec --workspace-folder "$workspace" npm run verify
devcontainer exec --workspace-folder "$workspace" bash
```

`up` runs `npm ci` as `node` on each new container. `exec` runs as `node`, with
`HOME=/home/node` and workspace `/workspaces/jevault`. Run `exit` to leave the
shell. Source edits, including generated `main.js`, reach the selected host
clone. Keep real Vaults, notes and secret files out of this clone.

## Codex startup, sandbox and first login

The [official installation instructions](https://learn.chatgpt.com/docs/codex/cli)
support npm installation. The image installs Codex globally during build;
Jevault's package manifest and lockfile do not acquire a Codex dependency.
Before logging in, run the official sandbox helper with synthetic input:

```sh
devcontainer exec --workspace-folder "$workspace" codex --help
devcontainer exec --workspace-folder "$workspace" codex sandbox --help
devcontainer exec --workspace-folder "$workspace" codex sandbox -c 'sandbox_mode="workspace-write"' -- sh -c 'printf "synthetic sandbox probe\n"'
devcontainer exec --workspace-folder "$workspace" node .devcontainer/check-sandbox.mjs
```

Codex 0.162.1 chooses the sandbox backend from the host OS; `linux` is not a
subcommand. See the [versioned CLI definition](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/cli/src/main.rs#L463-L482).
The manual acceptance probe runs only in the Linux container as UID 1000 with
`HOME=/home/node`. It first proves that ordinary Node can write its dedicated
HOME fixture, then requires a sandbox command to start, a workspace write to
succeed, an outside write to be denied and the outside contents to remain
unchanged. It removes only its generated fixtures. It requires no authentication,
does not alter configuration and is separate from normal `npm test`.
Run it only in a verification container without authentication state, then repeat
after recreation.
A namespace initialization failure is **FAIL**, with later checks **NOT RUN**;
it is not successful protection of the outside fixture. Only all stages passing
before and after recreation establishes these command/filesystem checks.

If this fails with `bwrap: No permissions to create new namespace`, stop Codex
development and report the runtime/security policy. Installing bubblewrap does
not guarantee that nested namespaces are permitted. See the
[official sandbox documentation](https://learn.chatgpt.com/docs/sandboxing).
Do not bypass the sandbox, use privileged mode, add capabilities, disable
seccomp or mount the Docker socket to make the probe pass. Any security-policy
exception needs a separate owner decision and review; none is configured here.
Project verification and lifecycle operations can still be tested.

When sandbox execution is supported, the owner performs initial login directly
in their terminal using the [official headless device flow](https://learn.chatgpt.com/docs/auth#login-on-headless-devices):

```sh
devcontainer exec --workspace-folder "$workspace" codex login --device-auth
devcontainer exec --workspace-folder "$workspace" codex login status
devcontainer exec --workspace-folder "$workspace" codex
```

Enable device-code login in ChatGPT security settings or workspace permissions,
then open the displayed link in your own browser and enter the one-time code.
If unavailable, ask the owner/admin; no alternate credential is copied.
Do not paste codes, credentials or full authentication logs into chat/Issues.
Real login and authentication continuity after recreation require owner
verification; a non-secret sentinel only tests storage continuity.

## Stop, resume, rebuild and recreate (host terminal)

The CLI has `up` and `exec`; it has no `stop` or `rebuild` subcommand. Select
exactly one container using both workspace labels before Docker operations:

```sh
container_id="$(docker ps -aq --filter "label=devcontainer.local_folder=$workspace" --filter "label=devcontainer.config_file=$workspace/.devcontainer/devcontainer.json")"
test -n "$container_id" && test "$(printf '%s\n' "$container_id" | wc -l)" -eq 1
# Proceed only if the preceding check succeeds.
docker stop "$container_id"
devcontainer up --workspace-folder "$workspace"
devcontainer exec --workspace-folder "$workspace" git status --short
```

Rebuild/recreate only this workspace's container (volumes remain):

```sh
devcontainer up --workspace-folder "$workspace" --remove-existing-container --build-no-cache
devcontainer exec --workspace-folder "$workspace" npm run verify
devcontainer exec --workspace-folder "$workspace" node .devcontainer/check-sandbox.mjs
devcontainer exec --workspace-folder "$workspace" codex login status
```

For removal followed by later recreation, refresh `container_id` with the
selection above, then run `docker stop "$container_id"` and
`docker rm "$container_id"`. Later run `devcontainer up` and `npm run verify`
as above. `shutdownAction: none` keeps lifecycle under explicit host control.

## State and complete removal

| Location | Storage / recreation behavior |
| --- | --- |
| `/workspaces/jevault` | Bind mount of only the selected clone; source persists on host |
| `/workspaces/jevault/node_modules` | Workspace-specific named volume; masks host dependencies; `npm ci` replaces container dependencies on recreation |
| `/home/node/.codex` | Workspace-specific named volume, initially mode 0700; Codex auth/config/history/logs persist |
| `/home/node/.npm`, other container files | Container writable layer; survives stop/resume, disappears on removal |
| GitHub credentials | Not supplied; `gh` is not installed |

Codex defaults to file-based cached authentication under its dedicated
`~/.codex` (including `auth.json`). No host authentication, home, SSH agent,
Keychain or personal settings are mounted. Do not share the state volume
between users. Moving the clone path changes container identity and may leave
old volumes; there is no promised cross-machine credential portability.

For **permanent removal including local Codex credentials/history**, first
select exactly one container as above and capture only its two volume names:

```sh
codex_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/node/.codex"}}{{.Name}}{{end}}{{end}}' "$container_id")"
modules_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/workspaces/jevault/node_modules"}}{{.Name}}{{end}}{{end}}' "$container_id")"
docker stop "$container_id"
docker rm "$container_id"
docker volume rm "$codex_volume" "$modules_volume"
```

Review the selected names before deleting. This leaves the host source and host
`node_modules` untouched. To sign out without deleting history, run
`devcontainer exec --workspace-folder "$workspace" codex logout`. Deleting a
local volume is not account-side revocation or guaranteed secure erasure of
Docker backups. Never use `docker system prune` for this workflow.

## Updates and security boundary

To update, check current stable official Node and Codex releases, change the
Node tag **and matching multi-platform digest**, and the explicit Codex version
in the Dockerfile. Debian packages resolve from maintained repositories at
build time, so Git/bubblewrap patch versions can change; this is not a bit-for-bit
image-build guarantee. Rebuild without cache and repeat versions, sandbox probe,
`npm run verify`, stop/resume, recreation and state checks. Update the host CLI
separately. Never update product dependencies solely to install development tools.
The Dockerfile intentionally has one stage; the regression guard requires exactly
one digest-pinned Node base and rejects additional stages, including pinned ones.

The build context is only `.devcontainer`, with no source/auth `COPY`. The
container process has network access for installations and Codex login/model
requests; commands launched by Codex retain its sandbox/approval controls.
Existing personal Codex configuration is not imported or modified.
Docker isolation and mode 0700 do not hide credentials from arbitrary code
running as the same user, container/host administrators or Docker access.
The Codex process may send selected project content to OpenAI as part of use.

Issue #137 must separately design any explicitly approved GitHub credential
supply and lifetime. It cannot assume that the host GitHub connector or Codex
login supplies container Git credentials. No token injection mechanism is
implemented here. Product behavior/version, release workflow and Issue #134's
fixed publication candidate are outside this environment change.
