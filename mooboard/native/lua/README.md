Lua 5.4.9, copyright 1994–2026 Lua.org, PUC-Rio, under the MIT license in src/lua.h.

Source: https://www.lua.org/source/5.4/ (retrieved 2026-10-28).
The source browser's link markup and four-space presentation indent were removed.
Trailing blank lines were normalized.
Core and base, math, string, table, coroutine and UTF-8 library sources are preserved.
The host never opens the coroutine library. OS, IO, package loading, debug, command-line
interpreter and compiler are excluded. The runtime loads text source only.

Host configuration: LUAI_MAXCCALLS is reduced from 200 to 3 for the board's task stacks, measured with
test/fixtures/runtime/stack-probe: an app's callback and one table.sort comparator or lua iterator under it. The
parser keeps a limit of 32 syntax levels of its own, LUAI_MAXPARSERLEVELS (llimits.h, lparser.c enterlevel), and
the board runs it on a stack of its own in psram, sized by tools/stack_depth.py for its worst cycle at that limit.
ldo.c's luaD_checkminstack lets a finalizer run below LUAI_MAXCCALLS, so a string buffer's box is collected while an
app runs. LUAL_BUFFERSIZE is 512 on every host, the board's own.
ldo.c's ccall meets the limit only for a call that runs lua again, so a C function called through it (a string
buffer's __close past LUAL_BUFFERSIZE, the string library's arithmetic) costs no level, and a 32-bit board and a
64-bit dev kit count alike.

Host changes for bounded app callbacks:
- lvm.c charges each string to number conversion through mb_lua_chargestring, which the
  host runtime defines, and a refused one fails the operation.
- lvm.c compares strings with one memcmp, the byte order strcoll gives in the C locale.
- ltm.c charges extra arguments copied by one instruction through mb_lua_chargevalues,
  which the host runtime defines.

luaconf.h also supplies long-long limit macros from the compiler when embedded C++
headers hide them, keeping the C and C++ hosts on the same 64-bit integer ABI.
