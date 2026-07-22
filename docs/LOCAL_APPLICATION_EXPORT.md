# Local application-document export

`scripts/export-applications.py` downloads every item from the configured DynamoDB
table, writes the raw DynamoDB response locally, and renders one completed
`ltrc_application.docx` and PDF per competitor or pending registration.

The files contain personal data and food-allergy declarations. They are written to
an owner-only directory under the ignored `exports/` path and must never be added to
Git, sent to an unapproved recipient, or copied into logs.

## Prerequisites

- AWS CLI configured with read access to `robo-compet` in `ap-southeast-7`.
- `python3` and either LibreOffice Writer (`libreoffice` or `soffice`) or Docker.
- The source template at `ltrc_application.docx` in the repository root.

## Run

```bash
python3 scripts/export-applications.py
```

To choose an output directory explicitly:

```bash
python3 scripts/export-applications.py --output exports/applications-20260722
```

The output includes `dynamodb-items.json` (the complete downloaded snapshot),
`manifest.json`, and a matched `.docx`/`.pdf` pair for each profile. The template’s
food-allergy placeholders are populated from the explicit per-student declarations;
older records with no declaration are marked `NOT DECLARED`, never assumed to be
allergy-free. The supplied template also has an advisor-allergy placeholder; because
advisors are not competitors and it is not collected by this form, exports mark it
`NOT DECLARED`.

`--docx-only` is available only for local template troubleshooting; the normal
command always creates both formats.

If LibreOffice is unavailable, the script starts a short-lived
`gotenberg/gotenberg:8` Docker container bound only to `127.0.0.1` and sends the
document to that local converter. The document is never sent to an external service.
