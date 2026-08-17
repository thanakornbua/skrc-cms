#!/usr/bin/env python3
"""Export DynamoDB competition data to operator CSV files.

Like export-applications.py this is a local operator tool: the output contains
personal data, so it uses the already authenticated AWS CLI, never uploads
anything, and writes an owner-only output directory containing a raw DynamoDB
snapshot plus four CSV files:

  runs.csv          every logged run, penalty and per-stage summary, per team
  teams.csv         one row per team member (team roster)
  participants.csv  one row per person, with that person's team result
  rankings.csv      every participant with its rank in every stage

Scoring mirrors backend/src/competition/scoring.ts exactly so the CSV ranking
matches what the scoreboard shows.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import functools
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent

# Mirrors backend/src/competition/types.ts.
COMPETITION_STAGES = ["ROUND_1", "BEST_OF_4", "BEST_OF_2", "THE_BEST"]
STAGE_LABELS = {
    "ROUND_1": "Qualifying round",
    "BEST_OF_4": "Quarterfinals",
    "BEST_OF_2": "Semifinals",
    "THE_BEST": "Finals",
}
# Per-attempt label prefix, so ROUND_1 attempts read "Qualification 1/2/3".
STAGE_ATTEMPT_LABELS = {
    "ROUND_1": "Qualification",
    "BEST_OF_4": "Quarterfinal",
    "BEST_OF_2": "Semifinal",
    "THE_BEST": "Final",
}
STAGE_SCORING = {
    "ROUND_1": "TIME_AVERAGE",
    "BEST_OF_4": "TIME_AVERAGE",
    "BEST_OF_2": "TIME_AVERAGE",
    "THE_BEST": "TIME_AVERAGE",
}
MAX_SAFE_INTEGER = 2 ** 53 - 1


def status(message: str) -> None:
    print(f"[results] {message}", flush=True)


def run_aws_scan(table: str, region: str) -> list[dict[str, Any]]:
    """Download every DynamoDB item, handling the 1 MB pagination boundary."""
    items: list[dict[str, Any]] = []
    last_key: dict[str, Any] | None = None
    page_number = 0
    while True:
        command = [
            "aws", "dynamodb", "scan", "--table-name", table,
            "--region", region, "--output", "json",
        ]
        if last_key:
            command.extend(["--exclusive-start-key", json.dumps(last_key)])
        result = subprocess.run(command, check=True, text=True, capture_output=True)
        page = json.loads(result.stdout)
        page_items = page.get("Items", [])
        items.extend(page_items)
        page_number += 1
        status(f"Downloaded DynamoDB page {page_number}: {len(page_items)} items ({len(items)} total)")
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
        return list(value["SS"])
    if "NS" in value:
        return [int(item) if re.fullmatch(r"-?\d+", item) else float(item) for item in value["NS"]]
    return None


def decode_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: unmarshal(value) for key, value in item.items()} for item in items]


def text(value: Any) -> str:
    return "" if value is None else str(value)


def ms_to_seconds(value: Any) -> str:
    """Render milliseconds as seconds with 3 decimals, for spreadsheet use."""
    if not isinstance(value, (int, float)):
        return ""
    return f"{value / 1000:.3f}"


def member_rows(profile: dict[str, Any]) -> list[tuple[str, str, str, str]]:
    """(role, Thai name, English name, food allergy) for every filled slot."""
    rows: list[tuple[str, str, str, str]] = []
    for index in (1, 2, 3):
        thai = text(profile.get(f"student{index}NameThai")).strip()
        english = text(profile.get(f"student{index}NameEnglish")).strip()
        allergy = text(profile.get(f"student{index}FoodAllergy")).strip()
        if thai or english:
            rows.append((f"Student {index}", thai, english, allergy))
    advisor_thai = text(profile.get("advisorNameThai")).strip()
    advisor_english = text(profile.get("advisorNameEnglish")).strip()
    if advisor_thai or advisor_english:
        rows.append(("Advisor", advisor_thai, advisor_english, ""))
    return rows


MEMBER_SLOTS = (1, 2, 3)
MEMBER_COLUMNS = [name for index in MEMBER_SLOTS
                  for name in (f"member{index}NameThai", f"member{index}NameEnglish")]


def member_fields(profile: dict[str, Any]) -> dict[str, str]:
    """One pair of columns per student slot, for the run and ranking files."""
    return {
        name: text(profile.get(f"student{index}Name{language}")).strip()
        for index in MEMBER_SLOTS
        for language, name in (("Thai", f"member{index}NameThai"),
                               ("English", f"member{index}NameEnglish"))
    }


# --- scoring (mirrors backend/src/competition/scoring.ts) ---------------------

def run_stage(run: dict[str, Any]) -> str:
    return text(run.get("stage")) or "ROUND_1"


def scored_runs(entry: dict[str, Any], stage: str) -> list[dict[str, Any]]:
    corrections = {
        text(item.get("runId")): item for item in entry["corrections"]
        if (text(item.get("stage")) or "ROUND_1") == stage
    }
    attempts = []
    for run in entry["runs"]:
        if run_stage(run) != stage or run.get("status") == "VOID":
            continue
        correction = corrections.get(text(run.get("runId")))
        completed = bool(correction) or run.get("status") == "COMPLETE"
        if correction is not None:
            elapsed = correction.get("elapsedMs")
        elif run.get("status") == "COMPLETE":
            elapsed = run.get("elapsedMs")
        elif run.get("status") in ("TIMED_OUT", "INVALID"):
            elapsed = run.get("maxTimeMs")
        else:
            elapsed = None
        splits = run.get("splits") or []
        attempts.append({
            "run": run,
            "elapsedMs": elapsed if isinstance(elapsed, (int, float)) else None,
            "uniqueCheckpoints": len({text(split.get("gateId")) for split in splits}),
            "completed": completed,
            "correction": correction,
        })
    attempts.sort(key=lambda item: text(item["run"].get("createdAt")))
    return attempts


def stage_penalties(entry: dict[str, Any], stage: str) -> list[dict[str, Any]]:
    return [item for item in entry["penalties"] if (text(item.get("stage")) or "ROUND_1") == stage]


def stage_penalty_ms(entry: dict[str, Any], stage: str) -> int:
    return sum(int(item.get("penaltyMs") or 0)
               for item in stage_penalties(entry, stage) if not item.get("revocation"))


def score_competitor_stage(entry: dict[str, Any], stage: str) -> dict[str, Any] | None:
    attempts = scored_runs(entry, stage)
    if not attempts:
        return None
    penalty_ms = stage_penalty_ms(entry, stage)
    mode = STAGE_SCORING[stage]
    competitor = entry["competitor"]

    timed = sorted(
        (item for item in attempts if item["elapsedMs"] is not None),
        key=lambda item: (item["elapsedMs"], text(item["run"].get("createdAt"))),
    )

    if mode == "CHECKPOINT_LAP":
        best_lap = timed[0] if timed else None
        furthest = max([item["uniqueCheckpoints"] for item in attempts] + [0])
        furthest_at = sorted(text(item["run"].get("createdAt")) for item in attempts
                             if item["uniqueCheckpoints"] == furthest)
        return {
            "teamName": text(competitor.get("teamName")),
            "competitorId": text(competitor.get("competitorId")),
            "stage": stage, "scoringMode": mode,
            "completedLap": best_lap is not None,
            "completedRunCount": len(timed),
            "lapTimeMs": best_lap["elapsedMs"] if best_lap else None,
            "secondBestTimeMs": timed[1]["elapsedMs"] if len(timed) > 1 else None,
            "furthestCheckpoint": furthest,
            "aggregateTimeMs": best_lap["elapsedMs"] if best_lap else None,
            "penaltyTimeMs": penalty_ms,
            "finalTimeMs": (best_lap["elapsedMs"] + penalty_ms) if best_lap else None,
            "tieTimestamp": text(best_lap["run"].get("createdAt")) if best_lap
                            else (furthest_at[0] if furthest_at else None),
            "countedRunIds": [text(best_lap["run"].get("runId"))] if best_lap else [],
        }

    if not timed:
        return None
    best = timed[:2]
    aggregate = math.ceil(sum(item["elapsedMs"] for item in best) / len(best))
    completed_times = sorted(item["elapsedMs"] for item in timed if item["completed"])
    return {
        "teamName": text(competitor.get("teamName")),
        "competitorId": text(competitor.get("competitorId")),
        "stage": stage, "scoringMode": mode,
        "completedLap": len(completed_times) > 0,
        "completedRunCount": len(completed_times),
        "lapTimeMs": completed_times[0] if completed_times else None,
        "secondBestTimeMs": completed_times[1] if len(completed_times) > 1 else None,
        "furthestCheckpoint": 0,
        "aggregateTimeMs": aggregate,
        "penaltyTimeMs": penalty_ms,
        "finalTimeMs": aggregate + penalty_ms,
        "tieTimestamp": text(competitor.get("createdAt")) or text(best[0]["run"].get("createdAt")),
        "countedRunIds": [text(item["run"].get("runId")) for item in best],
    }


def rank_stage_category(entries: list[dict[str, Any]], stage: str) -> list[dict[str, Any]]:
    """Rank one category's entries for one stage; returns ranked results only."""
    scored = [(entry, score_competitor_stage(entry, stage)) for entry in entries
              if not (entry["competitor"].get("disqualified") or {}).get("bool")]
    rankable = [(entry, result) for entry, result in scored if result is not None]

    def compare(a: tuple[dict[str, Any], dict[str, Any]], b: tuple[dict[str, Any], dict[str, Any]]) -> int:
        (a_entry, a_result), (b_entry, b_result) = a, b
        a_tier = min(a_result["completedRunCount"], 2)
        b_tier = min(b_result["completedRunCount"], 2)
        if a_tier != b_tier:
            return b_tier - a_tier
        if stage in ("ROUND_1", "BEST_OF_4"):
            if a_result["completedLap"] != b_result["completedLap"]:
                return -1 if a_result["completedLap"] else 1
            if not a_result["completedLap"]:
                return (
                    (b_result["furthestCheckpoint"] - a_result["furthestCheckpoint"])
                    or compare_text(a_result["tieTimestamp"], b_result["tieTimestamp"])
                    or compare_text(a_entry["competitor"].get("competitorId"),
                                    b_entry["competitor"].get("competitorId"))
                )
        return (
            (a_result["finalTimeMs"] - b_result["finalTimeMs"])
            or (coalesce(a_result["lapTimeMs"]) - coalesce(b_result["lapTimeMs"]))
            or (coalesce(a_result["secondBestTimeMs"]) - coalesce(b_result["secondBestTimeMs"]))
            or (a_result["penaltyTimeMs"] - b_result["penaltyTimeMs"])
            or compare_text(a_result["tieTimestamp"], b_result["tieTimestamp"])
            or compare_text(a_entry["competitor"].get("competitorId"),
                            b_entry["competitor"].get("competitorId"))
        )

    rankable.sort(key=functools.cmp_to_key(compare))
    return [{**result, "rank": index + 1, "entry": entry}
            for index, (entry, result) in enumerate(rankable)]


def coalesce(value: Any) -> int:
    return value if isinstance(value, (int, float)) else MAX_SAFE_INTEGER


def compare_text(a: Any, b: Any) -> int:
    left, right = text(a), text(b)
    return -1 if left < right else (1 if left > right else 0)


# --- data assembly -----------------------------------------------------------

def build_entries(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group every COMP# item under its competitor profile."""
    competitors = {
        text(item.get("competitorId")): item for item in items
        if item.get("SK") == "PROFILE" and item.get("GSI1PK") == "COMPETITOR"
    }
    entries = {
        competitor_id: {"competitor": profile, "runs": [], "corrections": [], "penalties": []}
        for competitor_id, profile in competitors.items()
    }
    for item in items:
        pk, sk = text(item.get("PK")), text(item.get("SK"))
        if not pk.startswith("COMP#"):
            continue
        entry = entries.get(pk.removeprefix("COMP#"))
        if entry is None:
            continue
        if sk.startswith("RUN#"):
            entry["runs"].append(item)
        elif sk.startswith("CORRECTION#"):
            entry["corrections"].append(item)
        elif sk.startswith("PENALTY#"):
            entry["penalties"].append(item)
    for entry in entries.values():
        entry["runs"].sort(key=lambda run: text(run.get("createdAt")))
        entry["penalties"].sort(key=lambda item: text(item.get("at")))
    return [entries[key] for key in sorted(entries)]


def pending_registrations(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    linked = {text(item.get("cognitoSub")) for item in items
              if item.get("SK") == "PROFILE" and item.get("GSI1PK") == "COMPETITOR"}
    pending = [
        item for item in items
        if item.get("SK") == "PROFILE" and item.get("GSI1PK") == "REGISTRATION"
        and text(item.get("PK")).removeprefix("REG#") not in linked
    ]
    return sorted(pending, key=lambda item: text(item.get("createdAt")))


def stages_with_data(entries: list[dict[str, Any]]) -> list[str]:
    """Every stage that has at least one run; ROUND_1 is always reported."""
    seen = {run_stage(run) for entry in entries for run in entry["runs"]}
    seen.add("ROUND_1")
    return [stage for stage in COMPETITION_STAGES if stage in seen]


# --- CSV writers -------------------------------------------------------------

RUN_COLUMNS = [
    "competitorId", "teamName", "category", "school", *MEMBER_COLUMNS,
    "stage", "stageLabel", "recordType", "label", "attempt",
    "runId", "laneId", "runStatus", "rawElapsedMs", "correctedElapsedMs",
    "effectiveTimeMs", "effectiveTimeSec", "countedInAverage",
    "penaltyMs", "penaltySec", "penaltyLabel", "penaltyRevoked", "penaltyRevokeReason",
    "reviewResolution", "reviewReason", "checkpointCount", "splits",
    "recordedAt", "recordedBy",
]


def write_runs_csv(path: Path, entries: list[dict[str, Any]]) -> int:
    rows = 0
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=RUN_COLUMNS)
        writer.writeheader()
        for entry in entries:
            competitor = entry["competitor"]
            base = {
                "competitorId": text(competitor.get("competitorId")),
                "teamName": text(competitor.get("teamName")),
                "category": text(competitor.get("category")),
                "school": text(competitor.get("school")),
                **member_fields(competitor),
            }
            for stage in COMPETITION_STAGES:
                attempts = scored_runs(entry, stage)
                penalties = stage_penalties(entry, stage)
                result = score_competitor_stage(entry, stage)
                voided = [run for run in entry["runs"]
                          if run_stage(run) == stage and run.get("status") == "VOID"]
                if not attempts and not penalties and not voided:
                    continue
                counted = set(result["countedRunIds"]) if result else set()
                stage_base = {**base, "stage": stage, "stageLabel": STAGE_LABELS[stage]}

                for number, attempt in enumerate(attempts, start=1):
                    run = attempt["run"]
                    splits = run.get("splits") or []
                    writer.writerow({
                        **stage_base,
                        "recordType": "RUN",
                        "label": f"{STAGE_ATTEMPT_LABELS[stage]} {number}",
                        "attempt": number,
                        "runId": text(run.get("runId")),
                        "laneId": text(run.get("laneId")),
                        "runStatus": text(run.get("status")) or "IN_PROGRESS",
                        "rawElapsedMs": text(run.get("elapsedMs")),
                        "correctedElapsedMs": text((attempt["correction"] or {}).get("elapsedMs")),
                        "effectiveTimeMs": text(attempt["elapsedMs"]),
                        "effectiveTimeSec": ms_to_seconds(attempt["elapsedMs"]),
                        "countedInAverage": "yes" if text(run.get("runId")) in counted else "no",
                        "reviewResolution": text(run.get("reviewResolution")),
                        "reviewReason": text(run.get("reviewReason"))
                                        or text((attempt["correction"] or {}).get("reason")),
                        "checkpointCount": attempt["uniqueCheckpoints"],
                        "splits": " | ".join(
                            f"{text(split.get('gateId'))}@{text(split.get('splitMs'))}ms"
                            for split in splits),
                        "recordedAt": text(run.get("createdAt")),
                    })
                    rows += 1

                # Void runs are excluded from scoring but still logged, and the
                # operator record needs to show they happened.
                for run in sorted(voided, key=lambda item: text(item.get("createdAt"))):
                    writer.writerow({
                        **stage_base,
                        "recordType": "VOID_RUN",
                        "label": f"{STAGE_ATTEMPT_LABELS[stage]} (void)",
                        "runId": text(run.get("runId")),
                        "laneId": text(run.get("laneId")),
                        "runStatus": "VOID",
                        "rawElapsedMs": text(run.get("elapsedMs")),
                        "countedInAverage": "no",
                        "reviewResolution": text(run.get("reviewResolution")),
                        "reviewReason": text(run.get("reviewReason")),
                        "recordedAt": text(run.get("createdAt")),
                    })
                    rows += 1

                for penalty in penalties:
                    revocation = penalty.get("revocation") or {}
                    writer.writerow({
                        **stage_base,
                        "recordType": "PENALTY",
                        "label": text(penalty.get("label")),
                        "runId": text(penalty.get("runId")),
                        "penaltyMs": text(penalty.get("penaltyMs")),
                        "penaltySec": ms_to_seconds(penalty.get("penaltyMs")),
                        "penaltyLabel": text(penalty.get("label")),
                        "penaltyRevoked": "yes" if revocation else "no",
                        "penaltyRevokeReason": text(revocation.get("reason")),
                        "recordedAt": text(penalty.get("at")),
                        "recordedBy": text(penalty.get("byUser")),
                    })
                    rows += 1

                if result:
                    writer.writerow({
                        **stage_base,
                        "recordType": "SUMMARY",
                        "label": f"{STAGE_LABELS[stage]} average (best 2 of {len(attempts)})",
                        "effectiveTimeMs": text(result["aggregateTimeMs"]),
                        "effectiveTimeSec": ms_to_seconds(result["aggregateTimeMs"]),
                        "penaltyMs": result["penaltyTimeMs"],
                        "penaltySec": ms_to_seconds(result["penaltyTimeMs"]),
                    })
                    writer.writerow({
                        **stage_base,
                        "recordType": "SUMMARY",
                        "label": f"{STAGE_LABELS[stage]} final time (average + penalty)",
                        "effectiveTimeMs": text(result["finalTimeMs"]),
                        "effectiveTimeSec": ms_to_seconds(result["finalTimeMs"]),
                        "penaltyMs": result["penaltyTimeMs"],
                        "penaltySec": ms_to_seconds(result["penaltyTimeMs"]),
                    })
                    rows += 2
    return rows


TEAM_COLUMNS = [
    "competitorId", "teamName", "category", "school", "registrationStatus",
    "memberRole", "memberNameThai", "memberNameEnglish", "foodAllergy",
]


def write_teams_csv(path: Path, entries: list[dict[str, Any]], pending: list[dict[str, Any]]) -> int:
    rows = 0
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=TEAM_COLUMNS)
        writer.writeheader()
        profiles = [(entry["competitor"], text(entry["competitor"].get("status")) or "REGISTERED")
                    for entry in entries]
        profiles += [(item, "PENDING_APPROVAL") for item in pending]
        for profile, registration_status in profiles:
            base = {
                "competitorId": text(profile.get("competitorId")),
                "teamName": text(profile.get("teamName")),
                "category": text(profile.get("category")),
                "school": text(profile.get("school")),
                "registrationStatus": registration_status,
            }
            members = member_rows(profile)
            if not members:
                writer.writerow(base)
                rows += 1
                continue
            for role, thai, english, allergy in members:
                writer.writerow({
                    **base, "memberRole": role, "memberNameThai": thai,
                    "memberNameEnglish": english, "foodAllergy": allergy,
                })
                rows += 1
    return rows


STAGE_COLUMN_PREFIXES = {
    "ROUND_1": "qualifying",
    "BEST_OF_4": "quarterfinal",
    "BEST_OF_2": "semifinal",
    "THE_BEST": "final",
}


def stage_rank_index(entries: list[dict[str, Any]], stages: list[str]) -> dict[str, dict[str, dict[str, Any]]]:
    """{stage: {competitorId: ranked result}} across every category."""
    categories = sorted({text(entry["competitor"].get("category")) for entry in entries})
    index: dict[str, dict[str, dict[str, Any]]] = {}
    for stage in stages:
        stage_index: dict[str, dict[str, Any]] = {}
        for category in categories:
            in_category = [entry for entry in entries
                           if text(entry["competitor"].get("category")) == category]
            for result in rank_stage_category(in_category, stage):
                stage_index[result["competitorId"]] = result
        index[stage] = stage_index
    return index


def write_participants_csv(path: Path, entries: list[dict[str, Any]], pending: list[dict[str, Any]]) -> int:
    """One row per person, carrying that person's team result in every stage."""
    stages = stages_with_data(entries)
    ranks = stage_rank_index(entries, stages)
    stage_columns = [
        name for stage in stages
        for name in (f"{STAGE_COLUMN_PREFIXES[stage]}Rank",
                     f"{STAGE_COLUMN_PREFIXES[stage]}RunsCompleted",
                     f"{STAGE_COLUMN_PREFIXES[stage]}AverageSec",
                     f"{STAGE_COLUMN_PREFIXES[stage]}PenaltySec",
                     f"{STAGE_COLUMN_PREFIXES[stage]}FinalSec")
    ]
    columns = [
        "competitorId", "teamName", "category", "school", "registrationStatus",
        "memberRole", "memberNameThai", "memberNameEnglish", "foodAllergy",
        "resultStatus", "bestStageReached", "bestStageRank",
        *stage_columns, "disqualifiedReason",
    ]

    rows = 0
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        profiles = [(entry["competitor"], entry) for entry in entries]
        profiles += [(item, None) for item in pending]
        for profile, entry in profiles:
            competitor_id = text(profile.get("competitorId"))
            disqualified = (profile.get("disqualified") or {}) if entry else {}
            results = {stage: ranks[stage].get(competitor_id) for stage in stages} if entry else {}
            reached = [stage for stage in stages if results.get(stage)]
            best_stage = reached[-1] if reached else ""

            base: dict[str, Any] = {
                "competitorId": competitor_id,
                "teamName": text(profile.get("teamName")),
                "category": text(profile.get("category")),
                "school": text(profile.get("school")),
                "registrationStatus": (text(profile.get("status")) or "REGISTERED") if entry
                                      else "PENDING_APPROVAL",
                "resultStatus": ("PENDING_APPROVAL" if not entry
                                 else "DISQUALIFIED" if disqualified.get("bool")
                                 else "RANKED" if reached else "UNRANKED"),
                "bestStageReached": STAGE_LABELS.get(best_stage, ""),
                "bestStageRank": results[best_stage]["rank"] if best_stage else "",
                "disqualifiedReason": text(disqualified.get("reason")),
            }
            for stage in stages:
                prefix = STAGE_COLUMN_PREFIXES[stage]
                result = results.get(stage)
                if not result:
                    continue
                base.update({
                    f"{prefix}Rank": result["rank"],
                    f"{prefix}RunsCompleted": result["completedRunCount"],
                    f"{prefix}AverageSec": ms_to_seconds(result["aggregateTimeMs"]),
                    f"{prefix}PenaltySec": ms_to_seconds(result["penaltyTimeMs"]),
                    f"{prefix}FinalSec": ms_to_seconds(result["finalTimeMs"]),
                })

            members = member_rows(profile)
            if not members:
                writer.writerow(base)
                rows += 1
                continue
            for role, thai, english, allergy in members:
                writer.writerow({
                    **base, "memberRole": role, "memberNameThai": thai,
                    "memberNameEnglish": english, "foodAllergy": allergy,
                })
                rows += 1
    return rows


RANKING_COLUMNS = [
    "category", "stage", "stageLabel", "source", "rank", "resultStatus",
    "competitorId", "teamName", "school", *MEMBER_COLUMNS,
    "completedLap", "completedRunCount", "bestTimeMs", "secondBestTimeMs",
    "averageTimeMs", "averageTimeSec", "penaltyMs", "penaltySec",
    "finalTimeMs", "finalTimeSec", "disqualifiedReason",
]


def write_rankings_csv(path: Path, entries: list[dict[str, Any]], official: list[dict[str, Any]]) -> int:
    rows = 0
    categories = sorted({text(entry["competitor"].get("category")) for entry in entries})
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=RANKING_COLUMNS)
        writer.writeheader()
        for stage in stages_with_data(entries):
            for category in categories:
                in_category = [entry for entry in entries
                               if text(entry["competitor"].get("category")) == category]
                ranked = rank_stage_category(in_category, stage)
                ranked_ids = {result["competitorId"] for result in ranked}
                stage_base = {"category": category, "stage": stage,
                              "stageLabel": STAGE_LABELS[stage], "source": "COMPUTED"}

                for result in ranked:
                    competitor = result["entry"]["competitor"]
                    writer.writerow({
                        **stage_base,
                        "rank": result["rank"],
                        "resultStatus": "RANKED",
                        "competitorId": result["competitorId"],
                        "teamName": result["teamName"],
                        "school": text(competitor.get("school")),
                        **member_fields(competitor),
                        "completedLap": "yes" if result["completedLap"] else "no",
                        "completedRunCount": result["completedRunCount"],
                        "bestTimeMs": text(result["lapTimeMs"]),
                        "secondBestTimeMs": text(result["secondBestTimeMs"]),
                        "averageTimeMs": text(result["aggregateTimeMs"]),
                        "averageTimeSec": ms_to_seconds(result["aggregateTimeMs"]),
                        "penaltyMs": result["penaltyTimeMs"],
                        "penaltySec": ms_to_seconds(result["penaltyTimeMs"]),
                        "finalTimeMs": text(result["finalTimeMs"]),
                        "finalTimeSec": ms_to_seconds(result["finalTimeMs"]),
                    })
                    rows += 1

                # Requirement: every participant appears in this file, ranked
                # or not.
                for entry in in_category:
                    competitor = entry["competitor"]
                    competitor_id = text(competitor.get("competitorId"))
                    if competitor_id in ranked_ids:
                        continue
                    disqualified = competitor.get("disqualified") or {}
                    writer.writerow({
                        **stage_base,
                        "resultStatus": "DISQUALIFIED" if disqualified.get("bool") else "UNRANKED",
                        "competitorId": competitor_id,
                        "teamName": text(competitor.get("teamName")),
                        "school": text(competitor.get("school")),
                        **member_fields(competitor),
                        "disqualifiedReason": text(disqualified.get("reason")),
                    })
                    rows += 1

        # Published rankings written when a category was concluded. Kept as
        # separate rows so a mismatch with the computed ranking stays visible.
        for item in official:
            writer.writerow({
                "category": text(item.get("PK")).removeprefix("RANKING#"),
                "stage": text(item.get("stage")),
                "stageLabel": STAGE_LABELS.get(text(item.get("stage")), ""),
                "source": "OFFICIAL",
                "rank": text(item.get("rank")),
                "resultStatus": "RANKED",
                "competitorId": text(item.get("competitorId")),
                "teamName": text(item.get("teamName")),
                "completedLap": "yes" if item.get("completedLap") else "no",
                "completedRunCount": text(item.get("completedRunCount")),
                "bestTimeMs": text(item.get("lapTimeMs")),
                "secondBestTimeMs": text(item.get("secondBestTimeMs")),
                "averageTimeMs": text(item.get("aggregateTimeMs")),
                "averageTimeSec": ms_to_seconds(item.get("aggregateTimeMs")),
                "penaltyMs": text(item.get("penaltyTimeMs")),
                "penaltySec": ms_to_seconds(item.get("penaltyTimeMs")),
                "finalTimeMs": text(item.get("finalTimeMs")),
                "finalTimeSec": ms_to_seconds(item.get("finalTimeMs")),
            })
            rows += 1
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "ap-southeast-7"))
    parser.add_argument("--table", default=os.environ.get("DYNAMO_TABLE", "robo-compet"))
    parser.add_argument("--output", type=Path,
                        default=ROOT / "exports" / f"results-{dt.datetime.now():%Y%m%d-%H%M%S}")
    parser.add_argument("--input", type=Path,
                        help="Use an existing DynamoDB JSON item array instead of calling AWS.")
    parser.add_argument("--include-pending", action="store_true",
                        help="Also list registrations awaiting approval in teams.csv.")
    parser.add_argument("--overwrite", action="store_true",
                        help="Allow replacing files in an existing output directory.")
    args = parser.parse_args()

    output = args.output.resolve()
    if output.exists() and any(output.iterdir()) and not args.overwrite:
        parser.error(f"Output directory exists and is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    os.chmod(output, 0o700)
    status(f"Output directory: {output}")

    if args.input:
        status(f"Loading DynamoDB snapshot from {args.input}")
        raw_items = json.loads(args.input.read_text(encoding="utf-8"))
    else:
        status(f"Connecting to DynamoDB table {args.table} in {args.region}")
        raw_items = run_aws_scan(args.table, args.region)
    if not isinstance(raw_items, list):
        parser.error("Input must be a JSON array of DynamoDB items")

    snapshot_path = output / "dynamodb-items.json"
    snapshot_path.write_text(json.dumps(raw_items, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(snapshot_path, 0o600)
    status(f"Saved protected data snapshot ({len(raw_items)} items)")

    items = decode_items(raw_items)
    entries = build_entries(items)
    if not entries:
        print("No approved competitors found; no CSV files generated.")
        return 0
    pending = pending_registrations(items) if args.include_pending else []
    official = sorted(
        (item for item in items if text(item.get("PK")).startswith("RANKING#")),
        key=lambda item: (text(item.get("PK")), text(item.get("SK"))),
    )
    total_runs = sum(len(entry["runs"]) for entry in entries)
    status(f"Found {len(entries)} team(s), {total_runs} logged run(s), "
           f"{len(official)} published ranking row(s)")

    for name, count in (
        ("runs.csv", write_runs_csv(output / "runs.csv", entries)),
        ("teams.csv", write_teams_csv(output / "teams.csv", entries, pending)),
        ("participants.csv", write_participants_csv(output / "participants.csv", entries, pending)),
        ("rankings.csv", write_rankings_csv(output / "rankings.csv", entries, official)),
    ):
        os.chmod(output / name, 0o600)
        status(f"Wrote {name} ({count} row{'s' if count != 1 else ''})")

    print(f"Done. CSV files are in {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
