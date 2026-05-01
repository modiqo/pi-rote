# Add Apache-2.0 license to pi-rote

## Goal

License this repository under the Apache License 2.0.

## Scope

- Add a top-level `LICENSE` file containing the full Apache License 2.0 text (copied verbatim from https://github.com/modiqo/api-specs/blob/main/LICENSE).
- Declare the package license in `package.json` as `Apache-2.0`.

## Non-goals

- No code changes.
- No NOTICE file (unless required later).
- No README changes (can be added later if desired).

## Acceptance criteria

- Repo root contains `LICENSE` with standard Apache-2.0 text.
- `package.json` contains a valid SPDX license identifier: `"license": "Apache-2.0"`.
