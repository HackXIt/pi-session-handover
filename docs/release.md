# Release and deployment

This repository is a Pi package. The extension is loaded from `package.json` through:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Pi can install it directly from a pinned git tag, or from an npm package registry when one is configured.

## CI pipelines

The repository contains CI for both GitHub and GitLab.

### GitHub Actions

`.github/workflows/ci.yml` runs on `main`, pull requests, and manual dispatch:

1. install dependencies with `npm ci`;
2. run `npm run ci`.

`.github/workflows/release.yml` runs on semantic-version tags and manual dispatch:

1. install dependencies with `npm ci`;
2. run `npm run ci`;
3. set the package version from the tag in the CI working copy;
4. run `npm pack`;
5. create a GitHub Release and upload the package tarball as a release asset.

### GitLab CI

`.gitlab-ci.yml` runs four stages when GitLab CI is enabled:

1. `test` — installs dependencies with `npm ci` and runs `npm run ci`.
2. `package` — runs `npm pack` and stores the generated tarball as a short-lived artifact.
3. `publish:gitlab-npm` — on semantic-version tags only, publishes the package to the GitLab npm Package Registry.
4. `release:gitlab` — on semantic-version tags only, creates a GitLab Release entry after package publication succeeds.

Branch pipelines validate and create pipeline artifacts, but they do not publish packages or create releases. Package registries and release pages are populated only after a semantic-version tag pipeline runs.

The shared CI check includes:

```bash
npm test
npm run typecheck
npm run package:check
```

## Versioning model

Release tags are the source of truth for package versions. Use tags like:

```text
v0.1.1
v0.2.0
v1.0.0
v1.0.0-beta.1
```

On a matching tag, CI strips the optional leading `v`, updates the package version inside the CI working copy with `npm version --no-git-tag-version`, and publishes that version through the configured release pipeline. The repository does not need a separate version-bump commit for each release.

## Install from GitHub

Pin a tag so `pi update --extensions` can reconcile the exact release:

```bash
pi install git:github.com/HackXIt/pi-session-handover@v0.1.1
```

The GitHub Release also contains the packed npm tarball as an asset for inspection or manual installation.

## Install from an npm package registry

After a tagged pipeline publishes the package, install it with a scoped npm registry entry. Example project `.pi/settings.json` shape:

```json
{
  "packages": ["npm:@hackxit/pi-session-handover@0.1.1"]
}
```

Configure npm for the package registry in the environment where Pi runs, for example:

```bash
npm config set @hackxit:registry https://gitlab.example.com/api/v4/packages/npm/
```

## GitLab Package Registry publishing

The GitLab deploy job writes a temporary `.npmrc` using GitLab CI variables:

- `CI_API_V4_URL`
- `CI_PROJECT_ID`
- `CI_JOB_TOKEN`

No project secret is required for the default GitLab Package Registry flow. If the GitLab instance restricts package publishing by job token, enable package publishing for CI job tokens or replace the token in the job with a protected project/group deploy token.

## Release checklist

1. Ensure `main` is green in CI.
2. Choose the next semantic version.
3. Create and push a tag to the release remote(s):

   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   git push upstream v0.1.1
   ```

4. Wait for the tag pipelines to complete.
5. Confirm the expected release targets are populated:
   - GitHub Release with the `.tgz` package asset;
   - GitLab Release, if GitLab CI is enabled;
   - GitLab npm package, if GitLab package publishing is enabled.
6. Install or update Pi using the new npm version or git tag.
