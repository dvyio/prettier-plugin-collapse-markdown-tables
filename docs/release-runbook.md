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

## 2. Run The Release Gate Locally

```bash
npm ci
npm run check:release
```

`check:release` runs typecheck, lint, format check, Knip, normal tests, dogfood formatting, stress tests, mutation tests, and package dry-run checks. GitHub runs the same release gate before publishing, but running it locally catches problems before you push.

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

Push the release commit to `main`, then wait for the workflows:

```bash
git push origin main
```

After `CI` passes on `main`, the `Publish` workflow checks `package.json`, `CHANGELOG.md`, npm, and existing tags. If the package version is not already published, it reruns `npm run check:release`, creates `v<version>`, publishes with `npm publish --access public --ignore-scripts`, then creates the GitHub release from the matching changelog entry.

Trusted publishing uses GitHub OIDC, so future publish jobs do not need `NPM_TOKEN`. npm creates provenance for public packages from public GitHub repositories.

If a future trusted publish fails with `ENEEDAUTH`, check that npm trusted publishing points to this repository and the exact workflow filename `publish.yml`.

## 5. Announce

1. Wait for the publish workflow to pass.
2. Check the npm package page after publish.
3. Install the package in a fresh temp project and run a small Prettier smoke test.
