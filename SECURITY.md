# Security Policy

## Supported scope

CollabVibe is under active development.

At this stage, security reports are especially welcome for:

- authentication or authorization bypass
- secret leakage
- unsafe command execution paths
- approval flow bypass
- file access or path traversal issues
- webhook verification issues

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security-sensitive reports.

Instead, report privately to the maintainers with:

- a clear description of the issue
- impact
- reproduction steps
- affected files or modules
- suggested mitigation, if available

If a dedicated security contact is added later, this file should be updated.

## Response expectations

Best effort target:

- initial acknowledgment within 7 days
- follow-up after triage when severity is understood

## Disclosure

Please allow maintainers reasonable time to validate and patch the issue before public disclosure.

## Hardening notes

This project handles:

- platform credentials
- backend command execution
- approval workflows
- local filesystem operations

Please assume reports touching these areas are security-relevant unless clearly proven otherwise.
