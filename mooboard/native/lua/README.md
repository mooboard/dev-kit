Lua 5.4.9, copyright 1994–2026 Lua.org, PUC-Rio, under the MIT license in src/lua.h.

Source: https://www.lua.org/source/5.4/ (retrieved 2026-10-28).
The source browser's link markup and four-space presentation indent were removed.
Trailing blank lines were normalized.
Core and base, math, string, table, coroutine and UTF-8 library sources are preserved.
The host never opens the coroutine library. OS, IO, package loading, debug, command-line
interpreter and compiler are excluded. The runtime loads text source only.

Host configuration: LUAI_MAXCCALLS is reduced from 200 to 32 for embedded task stacks.

luaconf.h also supplies long-long limit macros from the compiler when embedded C++
headers hide them, keeping the C and C++ hosts on the same 64-bit integer ABI.
