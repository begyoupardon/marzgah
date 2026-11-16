# Publishing the Marzgah CLI

The root website package stays private. The publishable package is `packages/cli`, named `@begyoupardon/marzgah`. Read its current version from `packages/cli/package.json`. Its public source metadata points only to https://github.com/begyoupardon/marzgah. Code remains `UNLICENSED` until the owner chooses a license.

## Build and review

```sh
bun install --frozen-lockfile
bun run build:cli
bun run test:cli-package
bun run pack:cli
```

The build emits a Bun executable, packaged SQL migrations, and a gzipped project template. Template input is an explicit allowlist; it excludes Git history, credentials, local databases, backups, workstation configuration and build output. Runtime dependencies remain npm dependencies; frontend dependencies are installed only when creating an application. Bun 1.4.4 or newer is required, including its native Archive API.

The smoke test installs the real npm tarball into a disposable directory with isolated environment variables. It checks the executable, version, scaffolding, overwrite protection, migrations, administrator creation, password reset, backup/restore and unconfigured doctor behavior. It never contacts your configured VPN backend or uses the development database. An internet connection is required to install the package's runtime dependencies.

Inspect `npm pack --dry-run ./packages/cli`, the generated `.tgz`, and its nested template before release. Tests do not replace a review for personal information. The generated template includes a frozen Bun lockfile and keeps the app package private. Third-party font notices must remain included.

## First publication

Use a clean release checkout of `begyoupardon/marzgah` with reviewed Git history. A different remote does not erase old authors, committers, signatures or commit IDs. Do not copy this development checkout's `.git` into a fresh identity-separated release. Configure the new account's noreply email locally and keep required third-party copyright notices.

The `prepublishOnly` check refuses another origin, a dirty checkout, unapproved Git author/committer identities, or a version tag mismatch. By default, the new account's noreply address and GitHub automation identities are allowed. Additional legitimate contributor addresses can be explicitly approved with a comma-separated `RELEASE_ALLOWED_EMAILS` environment variable. Do not approve your old identity if the release is intended to remain separate, and do not bypass publish scripts.

After building and testing in that checkout:

```sh
npm login
npm whoami
cd packages/cli
npm publish --access public
```

Verify that `npm whoami` is the intended npm account. This command publishes the package publicly; perform it only after confirming its name, scope ownership, license and contents. The npm account does not have to share the GitHub username, but it must own the package scope or have publishing permission.

## Subsequent releases with trusted publishing

1. In the npm package's settings, configure GitHub Actions as a trusted publisher: owner `begyoupardon`, repository `marzgah`, workflow filename `npm-publish.yml`, environment `npm`. Permit direct `npm publish` for this workflow.
2. In GitHub, create/configure the `npm` environment and add your desired release approval protection. The workflow runs only in the exact release repository and uses OIDC instead of an npm token.
3. Update `packages/cli/package.json` to the next version, build/test/review, and commit with the intended identity.
4. Push a version-matching tag, for example `cli-v0.1.1` for version `0.1.1`. The workflow checks the full Git history, builds the CLI, installs/tests its tarball, and publishes it.

Trusted publishing currently requires npm >=11.5.1 and Node >=22.14.0; this workflow uses Node 24 and npm 11. Public repository/package provenance is generated automatically and links the package to this release repository. Configure a trusted publisher shortly before its first use: an unused new configuration currently expires after two days.

Publishing guidance: https://docs.npmjs.com/trusted-publishers/

## Release 0.6.0: connection access

Version **0.6.0** includes per-user inbound selection, linked access templates, reseller allowlists/default templates, global required inbounds, Telegram access flows, and durable application/reconciliation. It ships migrations `0019_connection_access.sql` and `0020_protected_access_grants.sql`, the operator guide, and the production browser/accessibility test harness in generated projects.

The upgrade preserves existing user selections. It does not automatically enable inbounds for everyone. Configure that explicitly in **Administration → Connection access**, preview, then confirm.

### Maintainer: review, push, and publish

Run from the release repository, on `master`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run api:schemas:check
bun run test
bun run test:e2e
bun run build:cf
bun run build:cli
bun run test:cli-package
bun run pack:cli
```

Review `git diff`, the npm tarball contents, and the generated template. Version `0.6.0` and tag `cli-v0.6.0` must match. Commit the complete application/CLI changes with an allowed identity, then push:

```sh
git add -A
git commit -m "feat(access): release connection access management with CLI 0.6.0"
git push origin master
```

Wait for the **CI** workflow on that commit to pass. Then tag the reviewed commit and push the tag:

```sh
git tag -a cli-v0.6.0 -m "Marzgah CLI v0.6.0"
git push origin cli-v0.6.0
```

The tag triggers **Publish CLI to npm**. Complete any configured approval for the GitHub `npm` environment and wait for success. Do not reuse or move an already published version tag; use the next package version if a correction is needed.

Verify publication before upgrading a server:

```sh
npm view @begyoupardon/marzgah@0.6.0 version
bunx @begyoupardon/marzgah@0.6.0 --version
```

Both should report `0.6.0`. If publishing fails, inspect the Actions log first: common causes are a missing/mismatched trusted publisher, an unapproved Git identity, a tag/package version mismatch, or an already published version. Do not bypass the release checks.

### Operator: upgrade Bun with systemd

The following examples assume project `/opt/vpn-panel`, service `marzgah`, and service user `vpnpanel`. Substitute the real names from your unit file. Use the same Unix account that owns the panel and has Bun installed; running the upgrade as root can change file ownership. Keep the original `BETTER_AUTH_SECRET` and database path.

1. Locate the project, service user, environment file, and Bun path:

   ```sh
   sudo systemctl cat marzgah
   ```

2. Stop the service so it cannot write while files and schema are upgraded:

   ```sh
   sudo systemctl stop marzgah
   sudo systemctl is-active marzgah
   ```

   The last command should print `inactive` (its nonzero exit is expected).

3. In a shell as the panel's service user, run the pinned release from the project directory:

   ```sh
   cd /opt/vpn-panel
   bunx @begyoupardon/marzgah@0.6.0 upgrade --yes
   ```

   The command backs up SQLite and app files under `.marzgah-backups/upgrade-…`, preserves `.env` and `data/`, installs the frozen dependencies, applies migrations, and builds. Save the printed backup paths. Wait for **Panel files upgraded to 0.6.0** before continuing. Do not run the setup wizard or create a replacement administrator.

4. Still as the service user, verify the local installation before restarting:

   ```sh
   cat .marzgah-version
   bun run cli doctor --offline
   ```

   The marker should be `0.6.0`, and **Connection access schema** should report migrations 0019 and 0020 installed. `--offline` intentionally does not test connectivity or prove that the worker is running. Ensure `SCHEDULER=off` is not set in `.env`, the systemd unit, or its overrides; keep one scheduler-enabled instance.

5. Start the service and inspect its logs:

   ```sh
   sudo systemctl start marzgah
   sudo systemctl status marzgah --no-pager
   sudo journalctl -u marzgah -n 100 --no-pager
   ```

   No `daemon-reload` is needed unless you edited the unit itself. For another process manager, use its stop/start/status/log commands instead.

6. From the project directory as the service user, verify backend connectivity and HTTP readiness:

   ```sh
   bun run cli doctor
   curl --fail --silent --show-error http://127.0.0.1:3000/api/health
   ```

   Replace port 3000 with the service's configured port. Health should return `{"ok":true}`. Also open the public HTTPS URL and sign in.

7. Open **Administration → Connection access**. Confirm the inbound catalog and host summaries, create a template, and test one disposable user. To add an inbound to everyone, select it under **Required for everyone**, preview, and confirm. Watch pending/applied/failed counts; the Bun worker processes batches every 15 seconds. Existing custom choices and account status should remain unchanged. Test `/access username` in Telegram if you use the bot.

If upgrade fails, keep the service stopped and inspect its output. App source is restored automatically, but dependencies may need `bun install --frozen-lockfile`; migrations are forward-only, so the database is not automatically reverted. The app-file backup includes the previous build. For an explicit database rollback, use the printed pre-upgrade `panel.db` backup with the service stopped, following [restore instructions](deploy.md#backups-and-restore). Do not delete the live database or its WAL files as a troubleshooting step.
