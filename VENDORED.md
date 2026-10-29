# Vendored code

**None.** No file in this repository is vendored, and no upstream code is reused as verified.

PLAN K13 intended to vendor small modules from S36 (`9e281d0`), S39 (`d5f9e40`) and S40 (`307835b`) after their tests
passed in this repository. This repository was built in Dirty Mode, where no test can run, so the K13 consequence
applies: every such module was **not vendored; implemented here; upstream check deferred**. The pinned sources were
read as design references only. `docs/REUSE.md` lists which local file each one informed and the recorded
differences; DEFERRED-VALIDATION DV-08 is the later upstream comparison.

If a file is ever vendored, add a row here with: local path, upstream repository, commit, upstream path, license, the
exact bytes' sha256, and the test run that verified it.
