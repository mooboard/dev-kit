"""shared runtime + native python bindings"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

SOURCES = Path(__file__).resolve().parent / "native"


def library():
    files = sorted(p for p in SOURCES.rglob("*") if p.is_file())
    if not files:
        raise RuntimeError("The runtime sources are missing. Rebuild the dev kit.")
    digest = hashlib.sha256(b"mooboard-native-abi2")
    for path in files:
        digest.update(str(path.relative_to(SOURCES)).encode())
        digest.update(path.read_bytes())
    folder = Path(tempfile.gettempdir()) / ("mooboard-runtime-" + digest.hexdigest()[:20])
    suffix = ".dylib" if sys.platform == "darwin" else ".so"
    output = folder / ("runtime" + suffix)
    if not output.exists():
        cc, cxx = shutil.which("cc"), shutil.which("c++")
        if not cc or not cxx:
            raise RuntimeError("Live preview needs a C and C++ compiler. On macOS run xcode-select --install.")
        folder.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="build-", dir=folder) as temp:
            includes = ["-I" + str(SOURCES / p) for p in ("lua", "runtime", "json")]
            objects = []
            for source in sorted((SOURCES / "lua").glob("*.c")):
                obj = Path(temp) / (source.stem + ".o")
                subprocess.run([cc, "-O2", "-fPIC", *includes, "-c", str(source), "-o", str(obj)], check=True, capture_output=True)
                objects.append(str(obj))
            built = Path(temp) / output.name
            subprocess.run([cxx, "-std=c++17", "-O2", "-fPIC", "-shared", *includes,
                            str(SOURCES / "runtime" / "Runtime.cpp"), *objects, *(["-Wl,-install_name," + str(output)] if sys.platform == "darwin" else []), "-o", str(built)], check=True, capture_output=True)
            os.replace(built, output)
    lib = ctypes.CDLL(str(output))
    lib.mb_runtime_new.restype = ctypes.c_void_p
    signatures = {
        "free": [ctypes.c_void_p], "load": [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t],
        "json": [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_size_t],
        "frame": [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t],
        "call": [ctypes.c_void_p, ctypes.c_char_p],
        "pixels": [ctypes.c_void_p], "error": [ctypes.c_void_p],
        "state": [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t],
    }
    for name, args in signatures.items():
        getattr(lib, "mb_runtime_" + name).argtypes = args
    lib.mb_runtime_pixels.restype = ctypes.POINTER(ctypes.c_uint8)
    lib.mb_runtime_error.restype = ctypes.c_char_p
    lib.mb_runtime_state.restype = ctypes.c_size_t
    return lib


class Runtime:
    def __init__(self, source, settings=None, state=None):
        self.lib = library()
        self.ptr = self.lib.mb_runtime_new()
        if not self.ptr:
            raise RuntimeError("Not enough memory for the app runtime")
        self.json("settings", settings or {})
        self.json("state", state or {})
        body = source.encode("utf-8") if isinstance(source, str) else source
        self._check(self.lib.mb_runtime_load(self.ptr, body, len(body)))
        self.event("start")

    def _check(self, ok):
        if not ok:
            raise RuntimeError(self.lib.mb_runtime_error(self.ptr).decode("utf-8", errors="replace"))

    def json(self, name, value):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self._check(self.lib.mb_runtime_json(self.ptr, name.encode(), body, len(body)))

    def event(self, name, value=None):
        if value is not None:
            self.json("input", value)
        self._check(self.lib.mb_runtime_call(self.ptr, name.encode()))

    def frame(self, context):
        body = json.dumps(context, allow_nan=False).encode()
        self._check(self.lib.mb_runtime_frame(self.ptr, body, len(body)))
        return bytes(self.lib.mb_runtime_pixels(self.ptr)[:128 * 32 * 3])

    def state(self):
        output = ctypes.create_string_buffer(2049)
        count = self.lib.mb_runtime_state(self.ptr, output, len(output))
        if count == 0:
            raise RuntimeError(self.lib.mb_runtime_error(self.ptr).decode("utf-8", errors="replace"))
        if count >= len(output):
            raise RuntimeError("App state is too large")
        return json.loads(output.value)

    def close(self):
        if getattr(self, "ptr", None):
            self.lib.mb_runtime_free(self.ptr)
            self.ptr = None

    def __del__(self):
        self.close()
