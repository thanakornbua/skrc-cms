"""Pure timing state used by the competition-day desktop UI."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import time
from typing import Callable


class TimerState(str, Enum):
    READY = "READY"
    RUNNING = "RUNNING"
    FINISHED = "FINISHED"


@dataclass
class GateTimer:
    clock: Callable[[], float] = time.monotonic
    state: TimerState = TimerState.READY
    started_at: float | None = None
    elapsed: float = 0.0

    def trigger(self) -> TimerState:
        """Alternate stable sensor triggers between start and finish."""
        now = self.clock()
        if self.state in (TimerState.READY, TimerState.FINISHED):
            self.started_at = now
            self.elapsed = 0.0
            self.state = TimerState.RUNNING
        else:
            started_at = self.started_at if self.started_at is not None else now
            self.elapsed = max(0.0, now - started_at)
            self.state = TimerState.FINISHED
        return self.state

    def reset(self) -> None:
        self.state = TimerState.READY
        self.started_at = None
        self.elapsed = 0.0

    def value(self) -> float:
        if self.state == TimerState.RUNNING and self.started_at is not None:
            return max(0.0, self.clock() - self.started_at)
        return self.elapsed


def format_time(seconds: float) -> str:
    minutes, remainder = divmod(max(0.0, seconds), 60)
    return f"{int(minutes):02d}:{remainder:06.3f}"
