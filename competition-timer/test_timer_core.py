import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from timer_core import GateTimer, TimerState, format_time


class FakeClock:
    def __init__(self): self.now = 100.0
    def __call__(self): return self.now


class GateTimerTests(unittest.TestCase):
    def test_two_triggers_start_and_stop(self):
        clock = FakeClock()
        timer = GateTimer(clock=clock)
        self.assertEqual(timer.trigger(), TimerState.RUNNING)
        clock.now += 12.345
        self.assertAlmostEqual(timer.value(), 12.345)
        self.assertEqual(timer.trigger(), TimerState.FINISHED)
        self.assertAlmostEqual(timer.value(), 12.345)

    def test_reset(self):
        timer = GateTimer(clock=FakeClock())
        timer.trigger()
        timer.reset()
        self.assertEqual(timer.state, TimerState.READY)
        self.assertEqual(format_time(timer.value()), "00:00.000")

    def test_minutes_format(self):
        self.assertEqual(format_time(65.007), "01:05.007")


if __name__ == "__main__":
    unittest.main()
