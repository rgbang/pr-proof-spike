# GIF spike (T6 manual test)

Question: does a GIF stored on a `pr-proof-previews` branch show inline in a sticky PR comment,
using the safe two-step workflow (step 1 on PR code with no secrets, step 2 with write access
that never checks out PR code)? And which image URL form renders: `github.com/.../blob/...?raw=true`
(Form A) or `raw.githubusercontent.com` (Form B)?

Files: `.github/workflows/spike-run.yml` (step 1, name `pr-proof-spike-run`) and
`.github/workflows/spike-comment.yml` (step 2, listens for that exact name).

## Steps

1. Create a new throwaway **public** repo on GitHub (e.g. `pr-proof-gif-spike`) with a README so
   `main` exists. Public matters: private repos need auth for raw URLs, which is a separate test.
2. In Settings > Actions > General, make sure Actions are enabled and "Workflow permissions"
   allows the workflows to request write access (the workflow sets its own permissions).
3. Copy both workflow files into `.github/workflows/` and commit them straight to `main`.
   `workflow_run` only fires from workflows on the default branch.
4. Create a branch in the same repo, change any file, push, and open a PR into `main`.
5. In the Actions tab, watch `pr-proof-spike-run` finish, then `pr-proof-spike-comment` start.
6. Open the PR. Expected: ONE comment (with a hidden marker) showing 4 images.
7. Push a second commit to the PR branch. Expected: the same comment is updated (not a second
   comment) and now shows the new short SHA.

## What to look for (record the answers)

- Does Form A render the small (~5 MB) and large (~9 MB) GIF? Does it animate?
- Does Form B render them? Does it animate?
- Any size at which an image stops loading?
- Is there exactly one comment after the second push?
- Does the `pr-proof-previews` branch exist with `pr-<n>/<sha>-small.gif` and `-large.gif`?
- Did the verify step pass? Did either job ask for anything beyond the stated permissions?

## Notes

- Third-party actions are pinned by full commit SHA (resolved read-only with `gh api` on 2026-11-16:
  upload-artifact v7.0.2, download-artifact v8.0.2, github-script v9.0.0). Checkout is not used.
- Fork PRs are out of scope for this spike (same-repo PR only).
- Local check of the ffmpeg commands: about 4.9 MB (small) and 9.2 MB (large).
