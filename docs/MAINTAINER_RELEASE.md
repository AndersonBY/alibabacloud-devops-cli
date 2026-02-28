# Maintainer Release Notes (npm)

This repository publishes to npm via GitHub Actions workflow:

- `.github/workflows/publish-npm.yml`

## One-time setup

1. Configure npm Trusted Publisher (OIDC) to trust:
   `AndersonBY/alibabacloud-devops-cli` + workflow file `publish-npm.yml`.
2. Keep workflow permission `id-token: write` enabled.

## Release flow

1. Update `package.json` version (example: `0.1.1`).
2. Create and push matching tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

## What workflow validates

1. Tag version must equal `package.json.version`.
2. Dependency install, typecheck, and build must pass.
3. The same package version must not already exist on npm.
4. Publish runs as `npm publish --provenance` via OIDC trusted publishing.
