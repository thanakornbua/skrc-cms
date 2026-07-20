#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>

#include "gate_logic.h"

int main() {
  using namespace gate_logic;

  static_assert(QUEUE_CAPACITY >= 64);
  assert(!elapsedAtLeast(1099, 1000, DEBOUNCE_MS));
  assert(elapsedAtLeast(1100, 1000, DEBOUNCE_MS));
  assert(elapsedAtLeast(25, UINT32_MAX - 100, DEBOUNCE_MS));

  assert(!deadlineReached(999, 1000));
  assert(deadlineReached(1000, 1000));
  assert(deadlineReached(1001, 1000));
  assert(deadlineReached(10, UINT32_MAX - 5));

  assert(nextBackoff(1000) == 2000);
  assert(nextBackoff(16000) == RETRY_MAX_MS);
  assert(nextBackoff(RETRY_MAX_MS) == RETRY_MAX_MS);

  assert(shouldRetryHttpStatus(-1));
  assert(shouldRetryHttpStatus(0));
  assert(!shouldRetryHttpStatus(200));
  assert(!shouldRetryHttpStatus(400));
  assert(shouldRetryHttpStatus(500));

  char eventId[96];
  assert(formatEventId(eventId, sizeof(eventId), "esp32-lane1", 7, 42));
  assert(std::strcmp(eventId, "esp32-lane1-7-42") == 0);
  char tooSmall[8];
  assert(!formatEventId(tooSmall, sizeof(tooSmall), "esp32-lane1", 7, 42));

  std::cout << "PASS debounce rollover deadlines backoff retry-policy event-id queue-capacity\n";
}
