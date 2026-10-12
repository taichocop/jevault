# Opt-in Codex sandbox profile

The ordinary `.devcontainer/devcontainer.json` keeps Docker's default security
policy. Select `.devcontainer/sandbox/devcontainer.json` only after an explicit
owner security decision. This profile uses the same image and pinned tools.

## Security exception and startup

The profile applies exactly:

```text
--cap-drop=ALL
--security-opt=no-new-privileges=true
--security-opt=seccomp=unconfined
```

Removing Docker's syscall filter increases the kernel attack surface for code
outside Codex's command sandbox. Dropping capabilities and preventing privilege
gains do not restore that filter. Docker namespaces, mount boundaries and the
runtime's existing LSM policy remain. This is not an escape guarantee; see
[Docker's seccomp guidance](https://docs.docker.com/engine/security/seccomp/).
No setuid setup, added capability, AppArmor override or daemon change is used.
The runtime must permit unprivileged user namespaces. If a gate fails, stop and
report it; do not add privileges or weaken another policy automatically.

Start or resume Codex with the repository wrapper:

```sh
sh .devcontainer/sandbox/codex.sh
```

It selects workspace-write through the built-in `:workspace` profile, on-request
approval, Bubblewrap and Codex's managed network proxy with empty domain and
Unix-socket allowlists. Each invocation uses a fresh permission-profile name so
Codex's deep configuration merge cannot inherit entries from a saved same-name
profile. Existing configuration and authentication files are not rewritten. The network mode `full` is not an all-destinations grant:
proxy policy still rejects destinations. Direct local binding, upstream proxying
and SOCKS are disabled. See the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
and the [pinned proxy implementation](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/network-proxy/README.md).

The managed proxy lets Node use socket-backed subprocess/stdio facilities while
command networking remains restricted. This feature is experimental in the
pinned toolchain; repeat the gates on updates. The Codex parent and explicit
container lifecycle commands still have ordinary container networking for
service requests and dependency installation. An empty command allowlist is
not an outbound firewall for every container process. Network additions require
an explicit permission decision.

Workspace-write allows reads outside its writable roots. Same-user code and
administrators can inspect container credentials. Mount only a standalone clone
without notes or secrets; no host HOME, Keychain, SSH agent, Docker socket or
host credentials are supplied. Dedicated sandbox volumes do not inherit the
ordinary profile's Codex state.

## Validate an unauthenticated standalone clone

After owner approval, use the clean-clone prerequisites in
[CONTRIBUTING.md](../CONTRIBUTING.md). Execute sequentially, stopping on failure:

```sh
workspace="$(pwd -P)"
profile="$workspace/.devcontainer/sandbox/devcontainer.json"
devcontainer up --workspace-folder "$workspace" --config "$profile"
devcontainer exec --workspace-folder "$workspace" --config "$profile" npm ci
devcontainer exec --workspace-folder "$workspace" --config "$profile" npm run verify
devcontainer exec --workspace-folder "$workspace" --config "$profile" sh .devcontainer/sandbox/codex.sh sandbox -- npm run verify
devcontainer exec --workspace-folder "$workspace" --config "$profile" node .devcontainer/check-sandbox.mjs
devcontainer exec --workspace-folder "$workspace" --config "$profile" node .devcontainer/check-network.mjs
devcontainer exec --workspace-folder "$workspace" --config "$profile" node .devcontainer/check-sandbox.mjs --managed
devcontainer exec --workspace-folder "$workspace" --config "$profile" node .devcontainer/check-managed-network.mjs
devcontainer up --workspace-folder "$workspace" --config "$profile" --remove-existing-container --build-no-cache
devcontainer exec --workspace-folder "$workspace" --config "$profile" npm run verify
devcontainer exec --workspace-folder "$workspace" --config "$profile" sh .devcontainer/sandbox/codex.sh sandbox -- npm run verify
devcontainer exec --workspace-folder "$workspace" --config "$profile" node .devcontainer/check-sandbox.mjs
devcontainer exec --workspace-folder "$workspace" --config "$profile" node .devcontainer/check-network.mjs
devcontainer exec --workspace-folder "$workspace" --config "$profile" node .devcontainer/check-sandbox.mjs --managed
devcontainer exec --workspace-folder "$workspace" --config "$profile" node .devcontainer/check-managed-network.mjs
```

The filesystem probe checks an ordinary outside write, sandbox startup,
workspace write, explicit outside denial and unchanged outside contents.
The direct-network probe uses the same generated loopback endpoint for its
positive controls and denial. The managed-network probe requires a permitted
proxy control, direct denial and an explicit proxy 403 `blocked-by-allowlist`.
The wrapper's `--synthetic-loopback-control` option permits only the generated
loopback control through the sandbox helper; ordinary startup uses the empty
list. No probe contacts an external service. Initialization failure, connection failure
or timeout is FAIL, never proof of protection. Fixtures are synthetic and removed
by the probes. Normal tests use fakes and do not require Docker or Codex.

## Login, lifecycle and state

After the gates pass, the owner performs the documented device login directly
in their terminal, adding `--config "$profile"` to every Dev Container command.
Start Codex through the wrapper and check the terminal approval UI with a
synthetic outside fixture. Confirm both denial without modification and an
explicitly approved write. The sandbox helper does not test approval or login.
A storage sentinel does not prove real authentication continuity; verify login
again after recreation. Never paste codes or authentication logs into chat.

Stop/resume/removal follow CONTRIBUTING.md with the sandbox config-file label:

```sh
container_id="$(docker ps -aq --filter "label=devcontainer.local_folder=$workspace" --filter "label=devcontainer.config_file=$profile")"
test -n "$container_id" && test "$(printf '%s\n' "$container_id" | wc -l)" -eq 1
# Proceed only when exactly one container was selected.
docker stop "$container_id"
devcontainer up --workspace-folder "$workspace" --config "$profile"
```

Source persists in the selected clone. The two workspace-specific sandbox
volumes retain dependencies and Codex state through recreation; npm ci replaces
dependencies. Other container files disappear on removal. For permanent removal,
capture only this selected container's Codex and dependency volume names using
the CONTRIBUTING.md commands, then remove that container and those two volumes.
Do not delete ordinary-profile volumes or use a global prune command.

GitHub publishing authentication remains separate under #137. This profile does
not supply GitHub credentials or authorize any tag, release or merge.
