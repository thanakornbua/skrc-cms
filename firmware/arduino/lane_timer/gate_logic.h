#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace gate_logic {

constexpr uint32_t DEBOUNCE_MS = 100;
constexpr std::size_t QUEUE_CAPACITY = 64;
constexpr uint32_t RETRY_MIN_MS = 1000;
constexpr uint32_t RETRY_MAX_MS = 30000;

inline bool elapsedAtLeast(uint32_t now, uint32_t then, uint32_t interval) {
  return static_cast<uint32_t>(now - then) >= interval;
}

inline bool deadlineReached(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

inline uint32_t nextBackoff(uint32_t current) {
  if (current >= RETRY_MAX_MS / 2) return RETRY_MAX_MS;
  return current * 2;
}

inline bool shouldRetryHttpStatus(int status) {
  return status <= 0 || status >= 500;
}

inline bool formatEventId(char* output, std::size_t outputSize, const char* deviceId,
                          uint32_t bootCount, uint32_t sequenceNumber) {
  const int written = std::snprintf(output, outputSize, "%s-%lu-%lu", deviceId,
                                    static_cast<unsigned long>(bootCount),
                                    static_cast<unsigned long>(sequenceNumber));
  return written >= 0 && static_cast<std::size_t>(written) < outputSize;
}

}  // namespace gate_logic
