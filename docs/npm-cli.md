# Publishing the Marzgah CLI

The root website package stays private. The publishable package is `packages/cli`, named `@begyoupardon/marzgah`, version `0.1.0`. Its public source metadata points only to https://github.com/begyoupardon/marzgah. Confirm that you control the matching npm scope before publishing, or change the package name first. Code remains `UNLICENSED` until the owner chooses a license.

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
