# pi-session-handover project handover rules

This repository should showcase its own handover extension.

## Preferred workflow

1. Work in small vertical slices from `.plans/settings-ui-plan.md`.
2. Use TDD where practical: add or update one focused test, watch it fail, then implement the minimal code to pass.
3. Keep existing handover behavior stable while adding settings UI behavior.
4. Before handover, run:

   ```bash
   npm run ci
   ```

5. Commit completed work before calling `handover_complete` unless explicitly blocked.
6. If publishing is expected, push `main` to both remotes:

   ```bash
   git push origin main
   git push upstream main
   ```

## Handover prompt expectations

The replacement prompt must include:

- current commit and branch;
- plan path, usually `.plans/settings-ui-plan.md`;
- exact next slice;
- changed files and why they changed;
- validation output;
- known risks or blocked items;
- reminder that `/handover settings` should become the showcase settings UI for this extension.
