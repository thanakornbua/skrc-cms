#!/usr/bin/env python3
"""Fullscreen SKRC competition timer for Ubuntu and an Arduino serial gate."""

from __future__ import annotations

import argparse
import csv
import json
import queue
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # Friendly startup error when setup.sh was not used.
    serial = None
    list_ports = None

from timer_core import GateTimer, TimerState, format_time


NAVY = "#10182F"
NAVY_2 = "#16213E"
BLUE = "#1682C2"
PINK = "#E23A7E"
GOLD = "#E0B23C"
WHITE = "#FFFFFF"
MUTED = "#B8CAE0"
GREEN = "#35D08A"


@dataclass
class Round:
    round: str
    lane: str
    team: str


class SerialReader(threading.Thread):
    def __init__(self, port: str, messages: queue.Queue, stop: threading.Event):
        super().__init__(daemon=True)
        self.port, self.messages, self.stop = port, messages, stop

    def run(self) -> None:
        try:
            with serial.Serial(self.port, 115200, timeout=0.25) as connection:
                self.messages.put(("CONNECTED", self.port))
                while not self.stop.is_set():
                    raw = connection.readline()
                    if raw:
                        self.messages.put(("SERIAL", raw.decode("utf-8", errors="replace").strip()))
        except Exception as exc:
            self.messages.put(("ERROR", str(exc)))


class CompetitionTimerApp:
    def __init__(self, root: tk.Tk, rounds_path: Path, port: str | None):
        self.root = root
        self.rounds_path = rounds_path
        self.rounds = self.load_rounds(rounds_path)
        self.index = 0
        self.timer = GateTimer()
        self.messages: queue.Queue = queue.Queue()
        self.serial_stop = threading.Event()
        self.serial_thread: SerialReader | None = None
        self.connected = False
        self.beam_clear = True
        self.last_saved_state = TimerState.READY
        self.results_path = Path(__file__).resolve().parent / "results.csv"

        self.root.title("SKRC Competition Timer")
        self.root.configure(bg=NAVY)
        self.root.minsize(900, 600)
        self.root.attributes("-fullscreen", True)
        self.build_ui()
        self.bind_keys()
        self.refresh_round()
        self.tick()

        if port:
            self.connect_serial(port)
        else:
            self.auto_connect()

    @staticmethod
    def load_rounds(path: Path) -> list[Round]:
        try:
            content = json.loads(path.read_text(encoding="utf-8"))
            rounds = [Round(str(x["round"]), str(x["lane"]), str(x["team"])) for x in content]
            if rounds:
                return rounds
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise SystemExit(f"Could not load rounds from {path}: {exc}") from exc
        raise SystemExit("The rounds file must contain at least one round.")

    def build_ui(self) -> None:
        self.root.option_add("*Font", "Sarabun 14")
        self.shell = tk.Frame(self.root, bg=NAVY)
        self.shell.pack(fill="both", expand=True)

        top = tk.Frame(self.shell, bg=NAVY, padx=48, pady=24)
        top.pack(fill="x")
        tk.Label(top, text="SKRC · ROBOT COMPETITION", fg=MUTED, bg=NAVY,
                 font=("Kanit", 16, "bold")).pack(side="left")
        self.connection_label = tk.Label(top, text="●  กำลังค้นหาอุปกรณ์", fg=GOLD, bg=NAVY,
                                         font=("Sarabun", 13, "bold"))
        self.connection_label.pack(side="right")

        line = tk.Frame(self.shell, bg=BLUE, height=5)
        line.pack(fill="x")

        content = tk.Frame(self.shell, bg=NAVY, padx=56, pady=28)
        content.pack(fill="both", expand=True)

        self.round_label = tk.Label(content, fg=PINK, bg=NAVY, font=("Kanit", 25, "bold"))
        self.round_label.pack()
        self.team_label = tk.Label(content, fg=WHITE, bg=NAVY, font=("Kanit", 42, "bold"), pady=5)
        self.team_label.pack()
        self.lane_label = tk.Label(content, fg=MUTED, bg=NAVY, font=("Sarabun", 18))
        self.lane_label.pack()

        self.time_label = tk.Label(content, text="00:00.000", fg=WHITE, bg=NAVY,
                                   font=("DejaVu Sans Mono", 112, "bold"), pady=18)
        self.time_label.pack(expand=True)

        self.state_label = tk.Label(content, text="พร้อมแข่งขัน · READY", fg=NAVY, bg=GOLD,
                                    font=("Kanit", 24, "bold"), padx=28, pady=9)
        self.state_label.pack()

        bottom = tk.Frame(self.shell, bg=NAVY_2, padx=38, pady=18)
        bottom.pack(fill="x")
        self.progress_label = tk.Label(bottom, fg=MUTED, bg=NAVY_2, font=("DejaVu Sans Mono", 12))
        self.progress_label.pack(side="left")
        self.beam_label = tk.Label(bottom, text="BEAM CLEAR", fg=GREEN, bg=NAVY_2,
                                   font=("DejaVu Sans Mono", 12, "bold"))
        self.beam_label.pack(side="left", padx=28)
        tk.Label(bottom, text="SPACE เริ่ม/หยุด   R รีเซ็ต   ←/→ เปลี่ยนรอบ   F11 เต็มจอ   ESC ออกจากเต็มจอ",
                 fg=MUTED, bg=NAVY_2, font=("Sarabun", 11)).pack(side="right")

    def bind_keys(self) -> None:
        self.root.bind("<space>", lambda _e: self.handle_trigger("keyboard"))
        self.root.bind("r", lambda _e: self.reset_timer())
        self.root.bind("R", lambda _e: self.reset_timer())
        self.root.bind("<Right>", lambda _e: self.change_round(1))
        self.root.bind("<Left>", lambda _e: self.change_round(-1))
        self.root.bind("<F11>", lambda _e: self.toggle_fullscreen())
        self.root.bind("<Escape>", lambda _e: self.root.attributes("-fullscreen", False))
        self.root.protocol("WM_DELETE_WINDOW", self.close)

    def refresh_round(self) -> None:
        item = self.rounds[self.index]
        self.round_label.config(text=item.round)
        self.team_label.config(text=item.team)
        self.lane_label.config(text=item.lane)
        self.progress_label.config(text=f"ROUND {self.index + 1:02d} / {len(self.rounds):02d}")

    def change_round(self, step: int) -> None:
        if self.timer.state == TimerState.RUNNING:
            return
        self.index = min(max(self.index + step, 0), len(self.rounds) - 1)
        self.reset_timer()
        self.refresh_round()

    def handle_trigger(self, source: str) -> None:
        previous = self.timer.state
        state = self.timer.trigger()
        if state == TimerState.RUNNING:
            self.state_label.config(text="กำลังจับเวลา · RUNNING", bg=PINK, fg=WHITE)
        elif previous == TimerState.RUNNING:
            self.state_label.config(text="เข้าเส้นชัย · FINISHED", bg=GREEN, fg=NAVY)
            self.save_result(source)

    def reset_timer(self) -> None:
        self.timer.reset()
        self.last_saved_state = TimerState.READY
        self.time_label.config(text="00:00.000", fg=WHITE)
        self.state_label.config(text="พร้อมแข่งขัน · READY", bg=GOLD, fg=NAVY)

    def save_result(self, source: str) -> None:
        item = self.rounds[self.index]
        new_file = not self.results_path.exists()
        with self.results_path.open("a", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle)
            if new_file:
                writer.writerow(["timestamp", "round_number", "round", "lane", "team", "elapsed_seconds", "source"])
            writer.writerow([datetime.now().isoformat(timespec="seconds"), self.index + 1, item.round,
                             item.lane, item.team, f"{self.timer.value():.3f}", source])

    def auto_connect(self) -> None:
        if serial is None:
            self.connection_label.config(text="●  ไม่พบ pyserial · MANUAL MODE", fg=GOLD)
            return
        ports = list(list_ports.comports())
        likely = next((p.device for p in ports if any(tag in (p.description or "").lower()
                      for tag in ("arduino", "uno", "usb serial", "acm"))), None)
        if likely:
            self.connect_serial(likely)
        else:
            self.connection_label.config(text="●  ไม่พบ Arduino · MANUAL MODE", fg=GOLD)

    def connect_serial(self, port: str) -> None:
        if serial is None:
            messagebox.showerror("Missing dependency", "Run ./setup-ubuntu.sh first.")
            return
        self.serial_stop.clear()
        self.serial_thread = SerialReader(port, self.messages, self.serial_stop)
        self.serial_thread.start()

    def poll_serial(self) -> None:
        try:
            while True:
                kind, value = self.messages.get_nowait()
                if kind == "CONNECTED":
                    self.connected = True
                    self.connection_label.config(text=f"●  เชื่อมต่อ {value}", fg=GREEN)
                elif kind == "ERROR":
                    self.connected = False
                    self.connection_label.config(text="●  การเชื่อมต่อขาด · MANUAL MODE", fg=GOLD)
                elif kind == "SERIAL":
                    command = value.strip().upper()
                    if command == "TRIGGER":
                        self.beam_clear = False
                        self.beam_label.config(text="OBJECT DETECTED", fg=PINK)
                        self.handle_trigger("arduino")
                    elif command == "CLEAR":
                        self.beam_clear = True
                        self.beam_label.config(text="BEAM CLEAR", fg=GREEN)
        except queue.Empty:
            pass

    def tick(self) -> None:
        self.poll_serial()
        value = self.timer.value()
        self.time_label.config(text=format_time(value), fg=PINK if self.timer.state == TimerState.RUNNING else WHITE)
        self.root.after(16, self.tick)

    def toggle_fullscreen(self) -> None:
        self.root.attributes("-fullscreen", not bool(self.root.attributes("-fullscreen")))

    def close(self) -> None:
        self.serial_stop.set()
        self.root.destroy()


def main() -> None:
    parser = argparse.ArgumentParser(description="Fullscreen Arduino gate timer")
    parser.add_argument("--port", help="Serial port, e.g. /dev/ttyACM0 (auto-detected if omitted)")
    parser.add_argument("--rounds", type=Path, default=Path(__file__).with_name("rounds.json"))
    args = parser.parse_args()
    if not args.rounds.exists():
        example = Path(__file__).with_name("rounds.example.json")
        args.rounds = example

    root = tk.Tk()
    CompetitionTimerApp(root, args.rounds, args.port)
    root.mainloop()


if __name__ == "__main__":
    main()
