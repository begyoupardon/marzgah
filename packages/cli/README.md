# Marzgah CLI

Set up and administer a self-hosted Marzgah VPN reseller panel. Requires **Bun 1.4.4 or newer**; npm distributes this package, but the executable runs on Bun.

## Create a panel

```sh
bunx @begyoupardon/marzgah init my-panel
```

The CLI creates a complete project from the template bundled with this release, installs its dependencies, and starts the interactive setup wizard. It refuses to overwrite a non-empty directory. Setup supports Bun directly, Docker, and Cloudflare configuration instructions. Docker and Cloudflare require their respective tools/accounts.

To create files without installing dependencies, contacting your VPN backend, or requesting credentials:

```sh
bunx @begyoupardon/marzgah init my-panel --scaffold-only
cd my-panel
bun install --frozen-lockfile
bun run cli init
```

Inside an existing generated project, `init` with no directory runs the configuration wizard.

## Upgrade an existing panel

Run the newest CLI from the panel directory. It backs up the SQLite database and application files, preserves `.env`,
`data/`, `docker-compose.yml`, and `wrangler.jsonc`, then installs dependencies, applies migrations, and builds:

```sh
cd my-panel
bunx @begyoupardon/marzgah@latest upgrade
```

Stop the running panel service before upgrading, then restart it after the command succeeds. The command prints backup
paths and restores the previous app files automatically if installation, migration, or build fails. App source files
are refreshed from the release template, so keep custom app code in version control and review it before upgrading.
For an older project created before version tracking was added, the command asks for confirmation before its first
upgrade.

## Administer a panel

Run commands from the panel's directory, where its `.env` and data live:

```sh
cd my-panel
bunx @begyoupardon/marzgah doctor
bunx @begyoupardon/marzgah upgrade
bunx @begyoupardon/marzgah migrate
bunx @begyoupardon/marzgah create-admin
bunx @begyoupardon/marzgah reset-password
bunx @begyoupardon/marzgah backup --out ./backups/manual.db
```

Stop the panel before restoring a backup:

```sh
bunx @begyoupardon/marzgah restore ./backups/manual.db
```

Database administration commands operate on local SQLite. Cloudflare D1 migrations use Wrangler as described by the setup wizard. `DATABASE_PATH` defaults to `./data/panel.db`; relative paths are resolved from the current directory. The package ships its own migrations, with `MIGRATIONS_DIR` available as an explicit override. Environment variables take precedence over `.env` values. Use the CLI version matching your panel release when managing its database.

For repeated use, install the command with `bun add --global @begyoupardon/marzgah`, then run `marzgah --help`.

## Source and licensing

Source and issues: https://github.com/begyoupardon/marzgah

Application code currently has no open-source license (`UNLICENSED`); no license grant is implied. Third-party dependency licenses remain applicable. The bundled Arad font's SIL Open Font License is retained under `public/licenses/Arad-OFL.txt` in generated projects. Poppins is installed locally through its Fontsource package.
