# Release Runbook

Use this runbook when publishing `@dvyio/prettier-plugin-collapse-markdown-tables`.

## 1. Prepare The Release

1. Confirm `CHANGELOG.md` has the release notes.
2. Confirm `package.json` has the new version.
3. Confirm `package-lock.json` matches `package.json`.
4. Confirm `README.md` still describes the supported Node and Prettier range.
5. Confirm GitHub private vulnerability reporting is enabled, or add a private maintainer contact to `SECURITY.md`.
6. Confirm `NPM_TOKEN` is set in GitHub Actions secrets for the `0.1.0` bootstrap publish.

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

## 4. Publish `0.1.0`

The first publish uses a temporary npm automation token because npm trusted publishing can only be configured after the package exists.

Create a short-lived npm automation token with publish access, then add it to GitHub Actions secrets as `NPM_TOKEN`.

The workflow runs when a version tag is pushed:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The publish job runs `npm publish --access public --provenance`. npm runs the `prepublishOnly` release gate before it publishes.

If the workflow fails with `ENEEDAUTH`, confirm the `NPM_TOKEN` secret exists, has publish access, and has not expired.

## 5. Switch To Trusted Publishing

After `0.1.0` exists on npm, configure GitHub trusted publishing:

```bash
npm install -g npm@^11.10.0
npm trust github @dvyio/prettier-plugin-collapse-markdown-tables --repo dvyio/prettier-plugin-collapse-markdown-tables --file publish.yml
```

Then:

1. Revoke the temporary npm automation token.
2. Remove the `NPM_TOKEN` GitHub Actions secret.
3. Change the publish workflow back to tokenless `npm publish --access public`.
4. In npm package settings, require two-factor authentication and disallow tokens.

Trusted publishing uses GitHub OIDC, so future publish jobs do not need `NPM_TOKEN`. npm creates provenance for public packages from public GitHub repositories.

If a future trusted publish fails with `ENEEDAUTH`, check that npm trusted publishing points to this repository and the exact workflow filename `publish.yml`.

## 6. Announce

1. Wait for the publish workflow to pass.
2. Create a GitHub release from the changelog entry.
3. Check the npm package page after publish.
4. Install the package in a fresh temp project and run a small Prettier smoke test.
