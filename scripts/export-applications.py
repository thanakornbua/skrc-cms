#!/usr/bin/env python3
"""Export DynamoDB profiles to completed LTRC application DOCX/PDF files.

This is deliberately a local operator tool: its output contains personal and
health-related data. It uses the already authenticated AWS CLI, never uploads
data anywhere, and writes a complete raw DynamoDB snapshot plus one document
pair per team beneath an ignored, owner-only output directory.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ET.register_namespace("w", WORD_NS)


def qn(name: str) -> str:
    return f"{{{WORD_NS}}}{name}"


def run_aws_scan(table: str, region: str) -> list[dict[str, Any]]:
    """Download every DynamoDB item, handling the 1 MB pagination boundary."""
    items: list[dict[str, Any]] = []
    last_key: dict[str, Any] | None = None
    while True:
        command = [
            "aws", "dynamodb", "scan", "--table-name", table,
            "--region", region, "--output", "json",
        ]
        if last_key:
            command.extend(["--exclusive-start-key", json.dumps(last_key)])
        result = subprocess.run(command, check=True, text=True, capture_output=True)
        page = json.loads(result.stdout)
        items.extend(page.get("Items", []))
        last_key = page.get("LastEvaluatedKey")
        if not last_key:
            return items


def unmarshal(value: dict[str, Any]) -> Any:
    if "S" in value:
        return value["S"]
    if "N" in value:
        number = value["N"]
        return int(number) if re.fullmatch(r"-?\d+", number) else float(number)
    if "BOOL" in value:
        return value["BOOL"]
    if "NULL" in value:
        return None
    if "M" in value:
        return {key: unmarshal(item) for key, item in value["M"].items()}
    if "L" in value:
        return [unmarshal(item) for item in value["L"]]
    if "SS" in value:
        return value["SS"]
    if "NS" in value:
        return [unmarshal({"N": item}) for item in value["NS"]]
    if "B" in value or "BS" in value:
        return "[binary omitted]"
    raise ValueError(f"Unsupported DynamoDB value: {value.keys()}")


def decode_items(raw_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: unmarshal(value) for key, value in item.items()} for item in raw_items]


def iso_date(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return ""
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return value


def certificate_language(value: Any) -> str:
    return {
        "THAI": "ภาษาไทย / Thai",
        "ENGLISH": "ภาษาอังกฤษ / English",
        "BILINGUAL": "ไทยและอังกฤษ / Thai and English",
    }.get(value, str(value or ""))


def text(value: Any, fallback: str = "") -> str:
    if value is None or value == "":
        return fallback
    return str(value)


def fields_for(profile: dict[str, Any]) -> dict[str, str]:
    approval = profile.get("approval") or {}
    pdpa = profile.get("pdpaConsent") or {}
    competitor_id = text(profile.get("competitorId"), "PENDING")
    fields = {
        "PDPAVersion": text(pdpa.get("version")),
        "PDPAEffective": iso_date(pdpa.get("at")),
        "PDPA01Consent": "CONSENTED" if pdpa.get("accepted") else "",
        "CompetitorID": competitor_id,
        "AppliedDate": iso_date(profile.get("createdAt")),
        "ApproveDate": iso_date(approval.get("at")),
        "TeamName": text(profile.get("teamName")),
        "CompetitorEmail": text(profile.get("contactEmail")),
        "CompetitorPhoneNumber": text(profile.get("contactPhone")),
        "School": text(profile.get("school")),
        "CertificateLang": certificate_language(profile.get("certificateLanguage")),
        "AdvisorNameTH": text(profile.get("advisorNameThai")),
        "AdvisorNameEN": text(profile.get("advisorNameEnglish")),
        "AdvisorEmail": text(profile.get("advisorEmail")),
        "AdvisorPhone": text(profile.get("advisorPhone")),
        # Advisors are not competitors and the registration form does not
        # collect this medical declaration. Do not imply a negative result.
        "AdvisorAllergy": "NOT DECLARED",
        "Student1NameTH": text(profile.get("student1NameThai")),
        "Student1NameEN": text(profile.get("student1NameEnglish")),
        "Student2NameTH": text(profile.get("student2NameThai")),
        "Student2NameEN": text(profile.get("student2NameEnglish")),
        "Student3NameTH": text(profile.get("student3NameThai")),
        "Student3NameEN": text(profile.get("student3NameEnglish")),
        "Student1Allergy": text(profile.get("student1FoodAllergy"), "NOT DECLARED"),
        "Student2Allergy": text(profile.get("student2FoodAllergy"), "NOT DECLARED"),
        "Student3Allergy": text(profile.get("student3FoodAllergy"), "NOT DECLARED"),
        # The supplied template reserves a QR location. Keep the stable QR
        # payload visible even when the template has no embedded QR image.
        "TeamQRCode": competitor_id,
    }
    # The current template and older revisions use both spaced and unspaced
    # student placeholders. Populate either form without changing the source.
    fields.update({
        "Student 2 NameTH": fields["Student2NameTH"],
        "Student 2 NameEN": fields["Student2NameEN"],
        "Student 3 NameTH": fields["Student3NameTH"],
        "Student 3 NameEN": fields["Student3NameEN"],
    })
    return fields


def replace_placeholders(xml_path: Path, fields: dict[str, str]) -> None:
    """Replace placeholders even when Word has split one across several runs."""
    tree = ET.parse(xml_path)
    changed = False
    for paragraph in tree.getroot().iter(qn("p")):
        nodes = list(paragraph.iter(qn("t")))
        if not nodes:
            continue
        original = "".join(node.text or "" for node in nodes)
        replacement = original
        for key, value in fields.items():
            replacement = replacement.replace("{" + key + "}", value)
        if replacement == original:
            continue
        # Write the joined result into the first text run. This preserves the
        # surrounding paragraph/table layout and handles placeholders split by
        # Word formatting runs; remaining runs are emptied rather than removed.
        nodes[0].text = replacement
        if replacement[:1].isspace() or replacement[-1:].isspace():
            nodes[0].set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        for node in nodes[1:]:
            node.text = ""
        changed = True
    if changed:
        tree.write(xml_path, encoding="utf-8", xml_declaration=True)


def render_docx(template: Path, destination: Path, fields: dict[str, str]) -> None:
    with tempfile.TemporaryDirectory(prefix="ltrs-docx-") as temp_name:
        temp = Path(temp_name)
        with zipfile.ZipFile(template) as archive:
            archive.extractall(temp)
        for xml_path in (temp / "word").glob("*.xml"):
            replace_placeholders(xml_path, fields)
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
            for file_path in temp.rglob("*"):
                if file_path.is_file():
                    archive.write(file_path, file_path.relative_to(temp))


class PdfConverter:
    """Use local LibreOffice, falling back to a localhost-only Gotenberg container."""

    def __init__(self) -> None:
        self.soffice = shutil.which("libreoffice") or shutil.which("soffice")
        self.container_name: str | None = None
        self.endpoint: str | None = None

    def __enter__(self) -> "PdfConverter":
        if self.soffice:
            return self
        if not shutil.which("docker"):
            raise RuntimeError(
                "PDF output requires LibreOffice Writer or Docker. Install libreoffice-writer, or install/start Docker."
            )
        self.container_name = f"ltrs-gotenberg-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        subprocess.run(
            [
                "docker", "run", "--rm", "-d", "--name", self.container_name,
                "-p", "127.0.0.1::3000", "gotenberg/gotenberg:8",
            ],
            check=True,
            text=True,
            capture_output=True,
        )
        port = subprocess.run(
            ["docker", "port", self.container_name, "3000/tcp"],
            check=True, text=True, capture_output=True,
        ).stdout.strip().rsplit(":", 1)[-1]
        self.endpoint = f"http://127.0.0.1:{port}"
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"{self.endpoint}/health", timeout=2) as response:
                    if response.status == 200:
                        return self
            except OSError:
                time.sleep(1)
        raise RuntimeError("The local PDF converter did not become healthy")

    def __exit__(self, *_: object) -> None:
        if self.container_name:
            subprocess.run(["docker", "rm", "-f", self.container_name], check=False, capture_output=True)

    def convert(self, docx_path: Path, output_dir: Path) -> Path:
        pdf_path = output_dir / f"{docx_path.stem}.pdf"
        if self.soffice:
            with tempfile.TemporaryDirectory(prefix="ltrs-pdf-") as profile_name:
                subprocess.run(
                    [
                        self.soffice, "--headless", f"-env:UserInstallation=file://{profile_name}",
                        "--convert-to", "pdf", "--outdir", str(output_dir), str(docx_path),
                    ],
                    check=True, text=True, capture_output=True,
                )
        else:
            assert self.endpoint
            boundary = f"----ltrs-{uuid.uuid4().hex}"
            payload = (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="files"; filename="{docx_path.name}"\r\n'
                "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n"
            ).encode("utf-8") + docx_path.read_bytes() + f"\r\n--{boundary}--\r\n".encode("utf-8")
            request = urllib.request.Request(
                f"{self.endpoint}/forms/libreoffice/convert", data=payload, method="POST",
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                pdf_path.write_bytes(response.read())
        if not pdf_path.exists() or pdf_path.stat().st_size == 0:
            raise RuntimeError(f"PDF conversion did not create {pdf_path.name}")
        return pdf_path


def safe_stem(profile: dict[str, Any], sequence: int) -> str:
    identifier = text(profile.get("competitorId"), f"pending-{sequence:04d}")
    team = re.sub(r"[^A-Za-z0-9ก-๙._-]+", "-", text(profile.get("teamName"), "team"))
    return f"{identifier}-{team.strip('-')[:60] or 'team'}"


def profiles_from(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    registrations = {
        item.get("PK", "").removeprefix("REG#"): item
        for item in items
        if item.get("SK") == "PROFILE" and item.get("GSI1PK") == "REGISTRATION"
    }
    competitors = [
        item for item in items
        if item.get("SK") == "PROFILE" and item.get("GSI1PK") == "COMPETITOR"
    ]
    linked_subs = {text(item.get("cognitoSub")) for item in competitors}
    pending = [item for sub, item in registrations.items() if sub not in linked_subs]
    return sorted(competitors, key=lambda item: text(item.get("competitorId"))) + sorted(
        pending, key=lambda item: text(item.get("createdAt"))
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "ap-southeast-7"))
    parser.add_argument("--table", default=os.environ.get("DYNAMO_TABLE", "robo-compet"))
    parser.add_argument("--template", type=Path, default=ROOT / "ltrc_application.docx")
    parser.add_argument("--output", type=Path, default=ROOT / "exports" / f"applications-{dt.datetime.now():%Y%m%d-%H%M%S}")
    parser.add_argument("--input", type=Path, help="Use an existing DynamoDB JSON item array instead of calling AWS.")
    parser.add_argument("--docx-only", action="store_true", help="Skip PDF conversion (for template troubleshooting only).")
    parser.add_argument("--overwrite", action="store_true", help="Allow an existing empty output directory.")
    args = parser.parse_args()

    if not args.template.is_file():
        parser.error(f"Template not found: {args.template}")
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()) and not args.overwrite:
        parser.error(f"Output directory exists and is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    os.chmod(output, 0o700)

    if args.input:
        raw_items = json.loads(args.input.read_text(encoding="utf-8"))
    else:
        raw_items = run_aws_scan(args.table, args.region)
    if not isinstance(raw_items, list):
        parser.error("Input must be a JSON array of DynamoDB items")

    snapshot_path = output / "dynamodb-items.json"
    snapshot_path.write_text(json.dumps(raw_items, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(snapshot_path, 0o600)

    profiles = profiles_from(decode_items(raw_items))
    if not profiles:
        print("Downloaded 0 application profiles; no documents generated.")
        return 0

    manifest: list[dict[str, str]] = []
    converter = PdfConverter() if not args.docx_only else None
    with converter or tempfile.TemporaryDirectory() as active_converter:
        for sequence, profile in enumerate(profiles, start=1):
            stem = safe_stem(profile, sequence)
            docx_path = output / f"{stem}.docx"
            render_docx(args.template, docx_path, fields_for(profile))
            os.chmod(docx_path, 0o600)
            pdf_name = ""
            if converter:
                pdf_path = active_converter.convert(docx_path, output)
                os.chmod(pdf_path, 0o600)
                pdf_name = pdf_path.name
            manifest.append({"competitorId": text(profile.get("competitorId"), "PENDING"), "docx": docx_path.name, "pdf": pdf_name})

    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(manifest_path, 0o600)
    output_kind = "DOCX files" if args.docx_only else "DOCX/PDF pairs"
    print(f"Downloaded {len(raw_items)} DynamoDB items; generated {len(manifest)} {output_kind} in {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(error.stderr.strip() or str(error), file=sys.stderr)
        raise SystemExit(error.returncode)
    except RuntimeError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
