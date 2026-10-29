#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

struct lua_State;
struct lua_Debug;

namespace mooboard {

class Runtime {
 public:
  static constexpr int width = 128, height = 32;
  static constexpr size_t frameBytes = width * height * 3;
  static constexpr size_t memoryLimit = 512 * 1024;
  static constexpr size_t sourceLimit = 64 * 1024;
  static constexpr size_t stringLimit = 1024;
  static constexpr size_t bytesPerWork = 16, decodedPerWork = 4;
  static constexpr size_t parseStackBytes = 24 * 1024;
  Runtime();
  ~Runtime();
  Runtime(const Runtime&) = delete;
  Runtime& operator=(const Runtime&) = delete;
  bool load(const char* source, size_t size);
  bool setJson(const char* name, const char* json, size_t size);
  bool call(const char* event);
  bool frame(const char* context, size_t size);
  std::string stateJson();
  const char* error() const { return error_.c_str(); }
  const uint8_t* pixels() const { return pixels_; }
  size_t memoryUsed() const { return used_; }
  bool spend(size_t work) { if(work>work_)return false;work_-=work;return true; }
  // callback charging + stop after refusal
  bool charge(size_t work) { if(!charging_||spend(work))return true;charging_=false;return false; }
  void stopCharging() { charging_=false; }
  void overBudget() { overrun_="app exceeded its work budget"; }
  void pixel(int x, int y, uint32_t color, uint8_t alpha = 255);
  void clear(uint32_t color);
  void text(const char* words, size_t length, int x, int y, int size, uint32_t color);
  void line(int x0, int y0, int x1, int y1, uint32_t color);
 private:
  static void* allocate(void* user, void* ptr, size_t oldSize, size_t newSize);
  static void budget(lua_State* state, lua_Debug* debug);
  bool checked(int status);
  int parse(const char* source, size_t size);
  bool run(int arguments);
  lua_State* lua_ = nullptr;
  size_t used_ = 0;
  int remaining_ = 0, app_ = -2;
  size_t work_ = 32768;
  bool charging_ = false;
  const char* overrun_ = nullptr;
  uint8_t pixels_[frameBytes] = {};
  std::string error_;
};

}

extern "C" {
void* mb_runtime_new();
void mb_runtime_free(void* runtime);
int mb_runtime_load(void* runtime, const char* source, size_t size);
int mb_runtime_json(void* runtime, const char* name, const char* json, size_t size);
int mb_runtime_frame(void* runtime, const char* json, size_t size);
int mb_runtime_call(void* runtime, const char* event);
const uint8_t* mb_runtime_pixels(void* runtime);
const char* mb_runtime_error(void* runtime);
size_t mb_runtime_state(void* runtime, char* out, size_t capacity);
}
