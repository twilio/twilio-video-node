#!/usr/bin/env bash
# Checks a linux-x64 addon against the DT_NEEDED set and ABI floors in
# README.md's Requirements. Run it on an Ubuntu 24.04 build.
#
# Usage: scripts/check-linux-abi.sh <path to twilio_video_sdk_node*.node>
set -euo pipefail

BIN="${1:?usage: check-linux-abi.sh <binary>}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
STATUS=0

# The link prunes six of the seven X11 libraries CMakeLists asks for.
EXPECTED_DT_NEEDED='ld-linux-x86-64.so.2
libX11.so.6
libc.so.6
libgcc_s.so.1
libm.so.6
libstdc++.so.6'

# LC_ALL=C: the expected list is in byte order; libX11.so.6 moves under en_US.UTF-8.
ACTUAL_DT_NEEDED=$(objdump -p "$BIN" | awk '/NEEDED/ {print $2}' | LC_ALL=C sort)

if ! diff -u <(echo "$EXPECTED_DT_NEEDED") <(echo "$ACTUAL_DT_NEEDED"); then
  echo "::error::the shared library dependencies of ${BIN} changed. A library that appeared here is one every consumer must now install; one that vanished may mean a feature stopped being linked in."
  STATUS=1
else
  echo "::notice::DT_NEEDED matches the published set."
fi

# Upper bound; the table records the actual numbers.
{
  echo '### ABI floors'
  echo '| family | required | documented floor |'
  echo '| --- | --- | --- |'
} >> "$SUMMARY"

check_floor() {
  local FAMILY="$1" FLOOR="$2" MAX
  MAX=$(objdump -T "$BIN" | grep -oE "${FAMILY}_[0-9][0-9.]*" | sort -Vu | tail -1 || true)
  MAX="${MAX#"${FAMILY}"_}"

  echo "| ${FAMILY} | ${MAX:-none} | ${FLOOR} |" >> "$SUMMARY"

  if [ -z "$MAX" ]; then
    echo "::notice::${BIN} references no ${FAMILY}_ versioned symbols."
    return 0
  fi

  # sort -V puts the floor last only when MAX <= FLOOR.
  if [ "$(printf '%s\n%s\n' "$MAX" "$FLOOR" | sort -V | tail -1)" != "$FLOOR" ]; then
    echo "::error::${BIN} requires ${FAMILY}_${MAX}, above the ${FAMILY} ${FLOOR} floor documented in README.md. Build this platform in a container matching the documented floor, or change the floor deliberately and update README.md."
    STATUS=1
  else
    echo "::notice::${FAMILY} max ${MAX} (floor ${FLOOR})."
  fi
}

check_floor GLIBC 2.38
check_floor GLIBCXX 3.4.30
check_floor CXXABI 1.3.13

{
  echo ''
  echo '<details><summary>all versioned symbols referenced</summary>'
  echo ''
  echo '```'
  objdump -T "$BIN" | grep -oE 'GLIBC_[0-9.]+|GLIBCXX_[0-9.]+|CXXABI_[0-9.]+' | sort -Vu
  echo '```'
  echo '</details>'
} >> "$SUMMARY"

exit "$STATUS"
