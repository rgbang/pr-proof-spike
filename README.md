# pr-proof-spike (throwaway)

Temporary test repo for the pr-proof feasibility check. It checks two things:

1. **Headless run:** the test-video core records a narrated test video on an Ubuntu GitHub runner (`headless-spike` workflow).
2. **GIF in a PR comment:** the safe two-step workflow (`pr-proof-spike-run` and then `pr-proof-spike-comment`) posts a GIF stored on the `pr-proof-previews` branch in one sticky comment.

This repo will be deleted after the test.

Test PR 1: checks the sticky GIF comment.
Second push: the comment should update, not duplicate.
