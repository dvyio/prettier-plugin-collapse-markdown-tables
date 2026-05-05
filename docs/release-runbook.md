# Release Runbook

Use this runbook when publishing `@dvyio/prettier-plugin-collapse-markdown-tables`.

## 1. Prepare The Release

1. Confirm `CHANGELOG.md` has the release notes.
2. Confirm `package.json` has the new version.
3. Confirm `package-lock.json` matches `package.json`.
4. Confirm `README.md` still describes the supported Node and Prettier range.
5. Confirm GitHub private vulnerability reporting is enabled, or add a private maintainer contact to `SECURITY.md`.
6. Confirm npm trusted publishing points to `dvyio/prettier-plugin-collapse-markdown-tables` and the workflow filename `publish.yml`.

Keep `prettier-3-0` pinned. It is a compatibility fixture for the minimum supported Prettier peer.

## 2. Run The Release Gate

```bash
npm ci
npm run check:release
```

`check:release` runs typecheck, lint, format check, Knip, normal tests, dogfood formatting, stress tests, mutation tests, and package dry-run checks.

If README or dogfood Markdown output changed intentionally, run this before the release gate:

```bash
npm run format:dogfood:fix
```

## 3. Inspect The Package

```bash
npm pack --dry-run --json --silent
```

The package should include only the public docs, license, `package.json`, and built `dist` files.

## 4. Publish

Push a version tag after `main` has passed the release gate:

```bash
git tag v<version>
git push origin v<version>
```

The publish job builds the package, then runs `npm publish --access public --ignore-scripts`.

Trusted publishing uses GitHub OIDC, so future publish jobs do not need `NPM_TOKEN`. npm creates provenance for public packages from public GitHub repositories.

If a future trusted publish fails with `ENEEDAUTH`, check that npm trusted publishing points to this repository and the exact workflow filename `publish.yml`.

## 5. Announce

1. Wait for the publish workflow to pass.
2. Create a GitHub release from the changelog entry.
3. Check the npm package page after publish.
4. Install the package in a fresh temp project and run a small Prettier smoke test.
