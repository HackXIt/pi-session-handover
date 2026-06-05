# Release and deployment

This repository is a Pi package. The extension is loaded from `package.json` through:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Pi can install it directly from git, or from a GitLab npm package after a release tag has been published.

## CI pipeline

`.gitlab-ci.yml` runs three stages on GitLab:

1. `test` — installs dependencies with `npm ci` and runs `npm run ci`.
2. `package` — runs `npm pack` and stores the generated tarball as a short-lived artifact.
3. `publish:gitlab-npm` — on semantic-version tags only, publishes the package to the GitLab npm Package Registry.

The CI check includes:

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

On a matching tag, CI strips the optional leading `v`, updates the package version inside the CI working copy with `npm version --no-git-tag-version`, and publishes that version. The repository does not need a separate version-bump commit for each release.

## Publishing to GitLab npm Package Registry

The deploy job writes a temporary `.npmrc` using GitLab CI variables:

- `CI_API_V4_URL`
- `CI_PROJECT_ID`
- `CI_JOB_TOKEN`

No project secret is required for the default GitLab Package Registry flow. If the homelab instance restricts package publishing by job token, enable package publishing for CI job tokens or replace the token in the job with a protected project/group deploy token.

## Install from GitLab

After a tagged pipeline publishes the package, install it with a scoped npm registry entry. Example project `.pi/settings.json` shape:

```json
{
  "packages": ["npm:@hackxit/session-handover@0.1.1"]
}
```

Configure npm for the GitLab registry in the environment where Pi runs, for example:

```bash
npm config set @hackxit:registry https://git.lab.hackxit.com/api/v4/packages/npm/
```

For direct git installs, pin a tag so `pi update --extensions` can reconcile the exact release:

```bash
pi install git:git.lab.hackxit.com/github-mirrors/personal/session-handover.git@v0.1.1
```

## Release checklist

1. Ensure `main` is green in GitLab CI.
2. Choose the next semantic version.
3. Create and push a tag:

   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

4. Wait for `publish:gitlab-npm` to complete.
5. Install or update Pi using the new npm version or git tag.
