#!/usr/bin/env python3
# Regenerates frontend/public/schools.json from school68.xlsx (single-column
# official school name list). Stdlib only — no openpyxl/pandas dependency.
import json
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "school68.xlsx"
DEST = ROOT / "frontend" / "public" / "schools.json"
NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def main() -> None:
    with zipfile.ZipFile(SOURCE) as archive:
        shared_strings = [
            "".join(t.text or "" for t in si.findall(".//a:t", NS))
            for si in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("a:si", NS)
        ]
        rows = ET.fromstring(archive.read("xl/worksheets/sheet1.xml")).findall(
            ".//a:sheetData/a:row", NS
        )

    names = []
    for row in rows[1:]:  # first row is the header
        for cell in row.findall("a:c", NS):
            value = cell.find("a:v", NS)
            if value is None or value.text is None:
                continue
            text = shared_strings[int(value.text)] if cell.get("t") == "s" else value.text
            names.append(text.strip())

    unique_sorted = sorted({name for name in names if name})
    DEST.write_text(
        json.dumps(unique_sorted, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {len(unique_sorted)} unique school names to {DEST}")


if __name__ == "__main__":
    main()
