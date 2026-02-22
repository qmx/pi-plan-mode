# Releases

## Creating a Release

Releases are automated via GitHub Actions and triggered by git tags. The workflow uses npm OIDC trusted publishing (no tokens required).

1. Bump version in `package.json`:

```bash
npm version patch  # or minor, or major
```

2. Push with tags:

```bash
git push origin main --tags
```

The workflow automatically:
- Installs dependencies (`npm ci`)
- Publishes to npm (`npm publish --access public`)
- `prepublishOnly` script handles `clean && build`

After pushing the tag, verify the publish:

```bash
npm view pi-plan-mode
```

## Prerequisites

OIDC trusted publishing must be configured on [npmjs.com](https://www.npmjs.com):
- Package settings → Trusted Publishers
- Repository: `qmx/pi-plan-mode`
- Workflow: `publish.yml`

## Version Format

Follow [semantic versioning](https://semver.org):

- **Production**: `v1.2.3`
- **Pre-release**: `v1.0.0-beta.1`, `v1.0.0-rc.1`, `v1.0.0-alpha.1`
