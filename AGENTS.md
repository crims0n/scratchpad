# Repository workflow

- Keep `main` deployable. Do not commit or push directly to `main`.
- Start every change on a short-lived branch created from an up-to-date `main`.
- Use a descriptive branch name such as `feat/add-search`, `fix/login-timeout`, or `chore/update-deps`.
- Finish every change through a pull request. Run the relevant checks, review the diff, and use squash merge unless the maintainer requests otherwise.
- Open or reference an issue when a change needs discussion, acceptance criteria, coordination, or multiple pull requests. An issue is optional for small, self-contained changes.
- When a pull request completes an issue, include `Closes #<issue-number>` in its description.
- Keep branches and pull requests focused. Do not include unrelated edits, and delete the branch after it is merged.

