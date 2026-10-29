#include "pw_runtime/Runtime.h"
#include <ArduinoJson.h>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <new>
#include <initializer_list>
#include "pw_runtime/Font.h"
extern "C" {
#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"
}
#ifdef ESP_PLATFORM
#include <atomic>
#include <esp32-hal-log.h>
#include <esp_expression_with_stack.h>
#include <esp_heap_caps.h>
#endif

namespace mooboard {
namespace {
class HostJsonAllocator final : public ArduinoJson::Allocator {
 public:
  void* allocate(size_t n) override {
#ifdef ESP_PLATFORM
    return heap_caps_malloc(n,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
#else
    return std::malloc(n);
#endif
  }
  void deallocate(void* p) override {
#ifdef ESP_PLATFORM
    heap_caps_free(p);
#else
    std::free(p);
#endif
  }
  void* reallocate(void* p,size_t n) override {
#ifdef ESP_PLATFORM
    return heap_caps_realloc(p,n,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
#else
    return std::realloc(p,n);
#endif
  }
};
ArduinoJson::Allocator* hostJsonAllocator(){static HostJsonAllocator allocator;return &allocator;}
Runtime* owner(lua_State* l) { return *static_cast<Runtime**>(lua_getextraspace(l)); }
thread_local Runtime* tRunning = nullptr;
struct Parse {lua_State* l;const char* source;size_t size;int status;};
thread_local Parse* tParse = nullptr;
void parseHere(){Parse& p=*tParse;p.status=luaL_loadbufferx(p.l,p.source,p.size,"app.lua","t");}
void work(lua_State* l,size_t amount){if(!owner(l)->spend(amount)){owner(l)->stopCharging();luaL_error(l,"app exceeded its drawing budget");}}
uint32_t color(lua_State* l, int at, uint32_t fallback = 0xffffff) {
  if (lua_isnoneornil(l, at)) return fallback;
  if (lua_isinteger(l, at)) return uint32_t(lua_tointeger(l, at)) & 0xffffff;
  const char* s = luaL_checkstring(l, at);
  if (std::strlen(s) != 7 || s[0] != '#') luaL_error(l, "color must be #rrggbb or an RGB integer");
  uint32_t result = 0;
  for (int i = 1; i < 7; ++i) {
    const char c = s[i];
    const int n = c >= '0' && c <= '9' ? c-'0' : c >= 'a' && c <= 'f' ? c-'a'+10 : c >= 'A' && c <= 'F' ? c-'A'+10 : -1;
    if (n < 0) luaL_error(l, "color must be #rrggbb");
    result = result * 16 + uint32_t(n);
  }
  return result;
}
int coordinate(lua_State* l, int at) {
  const double n = luaL_checknumber(l, at);
  if (!std::isfinite(n) || n < -4096 || n > 4096) luaL_error(l, "coordinate must be between -4096 and 4096");
  return int(n);
}
int drawClear(lua_State* l) {work(l,4096);owner(l)->clear(color(l, 1, 0)); return 0; }
int drawPixel(lua_State* l) {work(l,1);const int x=coordinate(l,1), y=coordinate(l,2); owner(l)->pixel(x,y,color(l,3)); return 0; }
int drawLine(lua_State* l) {
  const int x=coordinate(l,1),y=coordinate(l,2),xx=coordinate(l,3),yy=coordinate(l,4);
  work(l,size_t(std::max(std::abs(xx-x),std::abs(yy-y)))+1);
  owner(l)->line(x,y,xx,yy,color(l,5)); return 0;
}
int drawRect(lua_State* l) {
  const int x=coordinate(l,1),y=coordinate(l,2),w=coordinate(l,3),h=coordinate(l,4);
  const uint32_t c=color(l,5); const bool fill=lua_isnoneornil(l,6)||lua_toboolean(l,6);
  work(l,size_t(std::max(0,std::min(Runtime::width,x+std::max(0,w))-std::max(0,x)))*size_t(std::max(0,std::min(Runtime::height,y+std::max(0,h))-std::max(0,y))));
  for(int row=std::max(0,y);row<std::min(Runtime::height,y+std::max(0,h));++row)
    for(int col=std::max(0,x);col<std::min(Runtime::width,x+std::max(0,w));++col)
      if(fill||row==y||row==y+h-1||col==x||col==x+w-1)owner(l)->pixel(col,row,c);
  return 0;
}
int drawCircle(lua_State* l) {
  const int x=coordinate(l,1),y=coordinate(l,2),r=coordinate(l,3); const uint32_t c=color(l,4);
  if(r<0||r>256)return luaL_error(l,"radius must be 0 to 256");
  work(l,size_t(std::max(0,std::min(Runtime::width,x+r+1)-std::max(0,x-r)))*size_t(std::max(0,std::min(Runtime::height,y+r+1)-std::max(0,y-r))));
  for(int row=std::max(0,y-r);row<std::min(Runtime::height,y+r+1);++row)
    for(int col=std::max(0,x-r);col<std::min(Runtime::width,x+r+1);++col)
      if((col-x)*(col-x)+(row-y)*(row-y)<=r*r)owner(l)->pixel(col,row,c);
  return 0;
}
int drawText(lua_State* l) {
  size_t n=0; const char* s=luaL_checklstring(l,1,&n);
  if(n>512)return luaL_error(l,"a text drawing is at most 512 bytes");
  const int x=coordinate(l,2), y=coordinate(l,3), size=int(luaL_optinteger(l,4,9));
  if(size!=6&&size!=8&&size!=9&&size!=11&&size!=13)return luaL_error(l,"text size must be 6, 8, 9, 11 or 13");
  work(l,n*size_t(size)*8);
  owner(l)->text(s,n,x,y,size,color(l,5)); return 0;
}
size_t bytesWork(size_t bytes){return (bytes+Runtime::bytesPerWork-1)/Runtime::bytesPerWork;}
size_t decodeWork(size_t bytes){return (bytes+Runtime::decodedPerWork-1)/Runtime::decodedPerWork;}
void charge(lua_State* l,size_t amount){if(!owner(l)->charge(amount))luaL_error(l,"app exceeded its work budget");}
void tooLong(lua_State* l){owner(l)->stopCharging();luaL_error(l,"app made a string longer than %d bytes",int(Runtime::stringLimit));}
int library(lua_State* l){return lua_tocfunction(l,lua_upvalueindex(1))(l);}
lua_Integer firstAt(lua_Integer pos,size_t len){return pos>0?pos:pos==0?1:pos<-lua_Integer(len)?1:lua_Integer(len)+pos+1;}
lua_Integer lastAt(lua_Integer pos,size_t len){return pos>lua_Integer(len)?lua_Integer(len):pos>=0?pos:pos<-lua_Integer(len)?0:lua_Integer(len)+pos+1;}
size_t span(lua_Integer first,lua_Integer last){
  return first>last?0:size_t(std::min<lua_Unsigned>(lua_Unsigned(last)-lua_Unsigned(first),lua_Unsigned(1)<<40))+1;
}
int guardRep(lua_State* l){
  size_t len=0,sep=0;luaL_checklstring(l,1,&len);const lua_Integer n=luaL_checkinteger(l,2);luaL_optlstring(l,3,"",&sep);
  if(n<=0||len+sep==0){lua_pushliteral(l,"");return 1;}
  if(n>lua_Integer(Runtime::stringLimit)+1)tooLong(l);
  const size_t total=size_t(n)*len+size_t(n-1)*sep;
  if(total>Runtime::stringLimit)tooLong(l);
  charge(l,bytesWork(total)+1);return library(l);
}
int guardByte(lua_State* l){
  size_t len=0;luaL_checklstring(l,1,&len);const lua_Integer first=luaL_optinteger(l,2,1);
  charge(l,span(firstAt(first,len),lastAt(luaL_optinteger(l,3,first),len))+1);return library(l);
}
int guardFormat(lua_State* l){size_t len=0;luaL_checklstring(l,1,&len);charge(l,decodeWork(len)+size_t(lua_gettop(l)));return library(l);}
int guardScan(lua_State* l){size_t len=0;luaL_checklstring(l,1,&len);charge(l,decodeWork(len)+1);return library(l);}
size_t tableLength(lua_State* l){luaL_checktype(l,1,LUA_TTABLE);return lua_rawlen(l,1);}
int guardConcat(lua_State* l){
  const size_t n=tableLength(l);const lua_Integer first=luaL_optinteger(l,3,1),last=luaL_optinteger(l,4,lua_Integer(n));
  charge(l,span(first,last)+1);return library(l);
}
int guardInsert(lua_State* l){
  const size_t n=tableLength(l);
  const lua_Integer at=lua_gettop(l)>=3?luaL_checkinteger(l,2):lua_Integer(n)+1;
  charge(l,(at>=1&&at<=lua_Integer(n)?size_t(lua_Integer(n)-at):0)+1);return library(l);
}
int guardRemove(lua_State* l){
  const size_t n=tableLength(l);const lua_Integer at=luaL_optinteger(l,2,lua_Integer(n));
  charge(l,(at>=1&&at<=lua_Integer(n)?size_t(lua_Integer(n)-at):0)+1);return library(l);
}
int guardUnpack(lua_State* l){
  const lua_Integer first=luaL_optinteger(l,2,1);
  const lua_Integer last=lua_isnoneornil(l,3)?lua_Integer(tableLength(l)):luaL_checkinteger(l,3);
  charge(l,span(first,last)+1);return library(l);
}
int guardSort(lua_State* l){
  const size_t n=tableLength(l);charge(l,n+1);
  size_t longest=0;
  for(size_t i=1;i<=n;++i){if(lua_rawgeti(l,1,lua_Integer(i))==LUA_TSTRING)longest=std::max(longest,size_t(lua_rawlen(l,-1)));lua_pop(l,1);}
  size_t depth=1;for(size_t m=n;m>1;m>>=1)++depth;
  charge(l,n*depth*(1+bytesWork(longest)));return library(l);
}
int guardCodepoint(lua_State* l){
  size_t len=0;luaL_checklstring(l,1,&len);
  const auto at=[len](lua_Integer pos){return pos>=0?pos:size_t(0)-size_t(pos)>len?0:lua_Integer(len)+pos+1;};
  const lua_Integer first=at(luaL_optinteger(l,2,1));
  const size_t count=span(first,at(luaL_optinteger(l,3,first)));charge(l,count+decodeWork(count)+1);return library(l);
}
int guardCodesStep(lua_State* l){
  size_t len=0;const char* s=luaL_checklstring(l,1,&len);const lua_Integer at=lua_tointeger(l,2);
  if(at>=0&&size_t(at)<len){
    size_t run=0;while(size_t(at)+run<len&&run<6&&(uint8_t(s[size_t(at)+run])&0xc0)==0x80)++run;
    if(run>5)return luaL_error(l,"invalid UTF-8 code");
  }
  return library(l);
}
int guardCodes(lua_State* l){
  const int n=library(l),first=lua_gettop(l)-n+1;
  if(n>=1&&lua_iscfunction(l,first)){lua_pushvalue(l,first);lua_pushcclosure(l,guardCodesStep,1);lua_replace(l,first);}
  return n;
}
int guardArith(lua_State* l){
  for(int i=1;i<=2;++i)if(lua_type(l,i)==LUA_TSTRING)charge(l,decodeWork(lua_rawlen(l,i))+1);
  return library(l);
}
int guardToNumber(lua_State* l){if(lua_type(l,1)==LUA_TSTRING)charge(l,decodeWork(lua_rawlen(l,1))+1);return library(l);}
void guard(lua_State* l,const char* name,lua_CFunction g){
  lua_getfield(l,-1,name);
  if(g){lua_pushcclosure(l,g,1);}else{lua_pop(l,1);lua_pushnil(l);}
  lua_setfield(l,-2,name);
}
int bootstrap(lua_State* l) {
  luaL_requiref(l,"_G",luaopen_base,1); lua_pop(l,1);
  for(const char* name:{"dofile","load","loadfile","collectgarbage","print","warn","pcall","xpcall","getmetatable","setmetatable"}) {
    lua_pushnil(l);lua_setglobal(l,name);
  }
  lua_pushglobaltable(l);guard(l,"tonumber",guardToNumber);lua_pop(l,1);
  luaL_requiref(l,LUA_MATHLIBNAME,luaopen_math,1);lua_pop(l,1);
  luaL_requiref(l,LUA_STRLIBNAME,luaopen_string,1);
  lua_pushliteral(l,"");
  if(lua_getmetatable(l,-1)){
    for(const char* name:{"__add","__sub","__mul","__mod","__pow","__div","__idiv","__unm"})guard(l,name,guardArith);
    lua_pop(l,1);
  }
  lua_pop(l,1);
  for(const char* name:{"dump","find","match","gmatch","gsub","pack","packsize","unpack"})guard(l,name,nullptr);
  guard(l,"rep",guardRep);guard(l,"byte",guardByte);guard(l,"format",guardFormat);
  for(const char* name:{"lower","upper","reverse"})guard(l,name,guardScan);
  lua_pop(l,1);
  luaL_requiref(l,LUA_TABLIBNAME,luaopen_table,1);guard(l,"move",nullptr);
  guard(l,"concat",guardConcat);guard(l,"insert",guardInsert);guard(l,"remove",guardRemove);
  guard(l,"unpack",guardUnpack);guard(l,"sort",guardSort);lua_pop(l,1);
  luaL_requiref(l,LUA_UTF8LIBNAME,luaopen_utf8,1);
  guard(l,"len",guardScan);guard(l,"offset",guardScan);guard(l,"codepoint",guardCodepoint);guard(l,"codes",guardCodes);
  lua_pop(l,1);
  const luaL_Reg functions[]={{"clear",drawClear},{"pixel",drawPixel},{"line",drawLine},{"rect",drawRect},{"circle",drawCircle},{"text",drawText},{nullptr,nullptr}};
  lua_newtable(l);luaL_setfuncs(l,functions,0);
  lua_pushinteger(l,128);lua_setfield(l,-2,"width");lua_pushinteger(l,32);lua_setfield(l,-2,"height");lua_setglobal(l,"screen");
  for(const char* name:{"settings","data","state","input","ctx"}){lua_newtable(l);lua_setglobal(l,name);}
  return 0;
}
void pushJson(lua_State* l, ArduinoJson::JsonVariantConst v, int depth=0) {
  using namespace ArduinoJson;
  if(depth>12){lua_pushnil(l);return;}
  if(v.is<JsonObjectConst>()) {
    lua_createtable(l,0,int(v.size()));
    for(JsonPairConst p:v.as<JsonObjectConst>()){pushJson(l,p.value(),depth+1);lua_setfield(l,-2,p.key().c_str());}
  }else if(v.is<JsonArrayConst>()) {
    lua_createtable(l,int(v.size()),0);int i=1;
    for(JsonVariantConst p:v.as<JsonArrayConst>()){pushJson(l,p,depth+1);lua_rawseti(l,-2,i++);}
  }else if(v.is<const char*>()) {
    const JsonString s=v.as<JsonString>();size_t n=s.size();
    if(n>Runtime::stringLimit){n=Runtime::stringLimit;while(n>0&&(uint8_t(s.c_str()[n])&0xc0)==0x80)--n;}
    lua_pushlstring(l,s.c_str(),n);
  }else if(v.is<bool>())lua_pushboolean(l,v.as<bool>());
  else if(v.is<int64_t>())lua_pushinteger(l,v.as<int64_t>());
  else if(v.is<double>())lua_pushnumber(l,v.as<double>());
  else lua_pushnil(l);
}
struct JsonInput {const char* name;ArduinoJson::JsonVariantConst value;};
int installJson(lua_State* l) {
  const auto* input=static_cast<const JsonInput*>(lua_touserdata(l,1));
  pushJson(l,input->value);lua_setglobal(l,input->name);return 0;
}
bool saveValue(lua_State* l,int index,ArduinoJson::JsonVariant out,int depth,size_t& count) {
  if(depth>8||++count>256)return false;
  index=lua_absindex(l,index);
  switch(lua_type(l,index)) {
    case LUA_TNIL:out.set(nullptr);return true;
    case LUA_TBOOLEAN:out.set(bool(lua_toboolean(l,index)));return true;
    case LUA_TNUMBER:{if(lua_isinteger(l,index)){out.set(int64_t(lua_tointeger(l,index)));return true;}double n=lua_tonumber(l,index);if(!std::isfinite(n))return false;out.set(n);return true;}
    case LUA_TSTRING:{size_t n=0;const char* s=lua_tolstring(l,index,&n);if(n>512)return false;out.set(std::string(s,n));return true;}
    case LUA_TTABLE:{
      const size_t length=lua_rawlen(l,index);
      if(length>256)return false;
      if(length) {
        auto array=out.to<ArduinoJson::JsonArray>();
        for(size_t i=1;i<=length;++i) {
          lua_rawgeti(l,index,lua_Integer(i));
          if(!saveValue(l,-1,array.add<ArduinoJson::JsonVariant>(),depth+1,count)){lua_pop(l,1);return false;}lua_pop(l,1);
        }
        lua_pushnil(l);
        while(lua_next(l,index)) {
          const bool valid=lua_isinteger(l,-2)&&lua_tointeger(l,-2)>=1&&size_t(lua_tointeger(l,-2))<=length;
          lua_pop(l,1);if(!valid){lua_pop(l,1);return false;}
        }
        return true;
      }
      auto object=out.to<ArduinoJson::JsonObject>();lua_pushnil(l);
      while(lua_next(l,index)) {
        if(lua_type(l,-2)!=LUA_TSTRING){lua_pop(l,2);return false;}
        const char* key=lua_tostring(l,-2);
        if(!saveValue(l,-1,object[key].to<ArduinoJson::JsonVariant>(),depth+1,count)){lua_pop(l,2);return false;}lua_pop(l,1);
      }return true;
    }
    default:return false;
  }
}
}

void* Runtime::allocate(void* user,void* ptr,size_t oldSize,size_t newSize) {
  auto* self=static_cast<Runtime*>(user);const size_t old=ptr?oldSize:0;
  if(newSize==0){if(ptr){
#ifdef ESP_PLATFORM
    heap_caps_free(ptr);
#else
    std::free(ptr);
#endif
    self->used_-=old;}return nullptr;}
  if(newSize>memoryLimit||self->used_-old>memoryLimit-newSize)return nullptr;
  if(!ptr&&oldSize==LUA_TSTRING&&newSize>stringLimit+2*sizeof(void*)+9){self->overrun_="app made a string longer than 1024 bytes";return nullptr;}
  // callback growth + persistent allocation refusal
  if(self->charging_&&newSize>old&&!self->spend(bytesWork(newSize-old))){self->overrun_="app exceeded its work budget";return nullptr;}
#ifdef ESP_PLATFORM
  void* next=heap_caps_realloc(ptr,newSize,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
#else
  void* next=std::realloc(ptr,newSize);
#endif
  if(next)self->used_=self->used_-old+newSize;
  return next;
}
Runtime::Runtime() {
  lua_=lua_newstate(allocate,this);if(!lua_){error_="not enough memory for app runtime";return;}
  *static_cast<Runtime**>(lua_getextraspace(lua_))=this;
  lua_pushcfunction(lua_,bootstrap);checked(lua_pcall(lua_,0,0,0));
}
Runtime::~Runtime(){if(lua_)lua_close(lua_);}
void Runtime::budget(lua_State* l,lua_Debug*) {
  auto* self=owner(l);self->remaining_-=1000;
  if(self->remaining_<=0){self->charging_=false;luaL_error(l,"app exceeded its instruction budget");}
}
bool Runtime::checked(int status) {
  if(status==LUA_OK){error_.clear();return true;}
  const char* why=lua_tostring(lua_,-1);error_=overrun_?overrun_:why?why:"app ran out of memory";
  lua_pop(lua_,1);return false;
}
bool Runtime::run(int arguments) {
  overrun_=nullptr;charging_=true;Runtime* outer=tRunning;tRunning=this;
  const int status=lua_pcall(lua_,arguments,LUA_MULTRET,0);charging_=false;tRunning=outer;
  return checked(status);
}
// parser stack in psram + synchronous completion
int Runtime::parse(const char* source,size_t size) {
  Parse job{lua_,source,size,-1};Parse* outer=tParse;tParse=&job;
#ifdef ESP_PLATFORM
  static SemaphoreHandle_t lock=xSemaphoreCreateMutex();static std::atomic<size_t> deepest{0};
  auto* stack=static_cast<uint8_t*>(heap_caps_malloc(parseStackBytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
  if(lock&&stack) {
    esp_execute_shared_stack_function(lock,stack,parseStackBytes,parseHere);
    // downward stack + untouched fill bytes
    size_t untouched=0;while(untouched<parseStackBytes&&stack[untouched]==0xa5)++untouched;
    const size_t used=parseStackBytes-untouched;size_t peak=deepest.load();
    while(used>peak&&!deepest.compare_exchange_weak(peak,used)){}
    if(used>peak)log_i("lua parse stack peak %u of %u bytes",unsigned(used),unsigned(parseStackBytes));
  }
  heap_caps_free(stack);
#else
  parseHere();
#endif
  tParse=outer;return job.status;
}
bool Runtime::load(const char* source,size_t size) {
  if(!lua_||!source||size==0||size>sourceLimit){error_="app source must be 1 to 65536 bytes";return false;}
  overrun_=nullptr;const int parsed=parse(source,size);
  if(parsed<0){error_="not enough memory to load app";return false;}
  if(!checked(parsed))return false;
  remaining_=200000;work_=32768;lua_sethook(lua_,budget,LUA_MASKCOUNT,1000);
  const int base=lua_gettop(lua_)-1;
  if(!run(0))return false;
  lua_settop(lua_,base+1);
  if(!lua_istable(lua_,-1)){lua_pop(lua_,1);error_="app.lua must return a table of callbacks";return false;}
  if(app_!=LUA_NOREF)luaL_unref(lua_,LUA_REGISTRYINDEX,app_);
  app_=luaL_ref(lua_,LUA_REGISTRYINDEX);
  lua_rawgeti(lua_,LUA_REGISTRYINDEX,app_);lua_getfield(lua_,-1,"frame");const bool frame=lua_isfunction(lua_,-1);lua_pop(lua_,2);
  if(!frame){error_="app needs a frame callback";return false;}return true;
}
bool Runtime::setJson(const char* name,const char* json,size_t size) {
  if(!lua_||!name||!json||size>32768){error_="app JSON exceeds 32768 bytes";return false;}
  if(std::strcmp(name,"settings")&&std::strcmp(name,"data")&&std::strcmp(name,"state")&&std::strcmp(name,"input")&&std::strcmp(name,"ctx")){
    error_="unknown app context";return false;
  }
  ArduinoJson::JsonDocument doc(hostJsonAllocator());
  if(ArduinoJson::deserializeJson(doc,json,size,ArduinoJson::DeserializationOption::NestingLimit(12))){error_="invalid app JSON";return false;}
  JsonInput input{name,doc.as<ArduinoJson::JsonVariantConst>()};lua_pushcfunction(lua_,installJson);lua_pushlightuserdata(lua_,&input);
  overrun_=nullptr;return checked(lua_pcall(lua_,1,0,0));
}
bool Runtime::call(const char* event) {
  if(!lua_||app_==LUA_NOREF){error_="app has not been loaded";return false;}
  const int base=lua_gettop(lua_);lua_rawgeti(lua_,LUA_REGISTRYINDEX,app_);lua_getfield(lua_,-1,event);
  if(lua_isnil(lua_,-1)){lua_settop(lua_,base);return true;}
  if(!lua_isfunction(lua_,-1)){lua_settop(lua_,base);error_="app callback must be a function";return false;}
  lua_getglobal(lua_,"ctx");remaining_=40000;work_=32768;lua_sethook(lua_,budget,LUA_MASKCOUNT,1000);
  const bool ok=run(1);lua_settop(lua_,base);return ok;
}
bool Runtime::frame(const char* context,size_t size){clear(0);return setJson("ctx",context,size)&&call("frame");}
std::string Runtime::stateJson() {
  if(!lua_)return "{}";const int base=lua_gettop(lua_);lua_getglobal(lua_,"state");
  ArduinoJson::JsonDocument doc(hostJsonAllocator());size_t count=0;
  const bool ok=lua_istable(lua_,-1)&&lua_rawlen(lua_,-1)==0&&saveValue(lua_,-1,doc.to<ArduinoJson::JsonVariant>(),0,count);lua_settop(lua_,base);
  std::string result;if(ok)ArduinoJson::serializeJson(doc,result);
  if(!ok||result.size()>2048){error_="state must be a JSON object of at most 2048 bytes";return "";}return result;
}
void Runtime::pixel(int x,int y,uint32_t c,uint8_t a) {
  if(x<0||y<0||x>=width||y>=height)return;uint8_t* p=pixels_+(y*width+x)*3;
  for(int channel=0;channel<3;++channel){const int value=int((c>>(16-8*channel))&255);p[channel]=uint8_t((p[channel]*(255-a)+value*a+127)/255);}
}
void Runtime::clear(uint32_t c){for(int i=0;i<width*height;++i){pixels_[i*3]=uint8_t(c>>16);pixels_[i*3+1]=uint8_t(c>>8);pixels_[i*3+2]=uint8_t(c);}}
void Runtime::line(int x,int y,int xx,int yy,uint32_t c) {
  int dx=std::abs(xx-x),sx=x<xx?1:-1,dy=-std::abs(yy-y),sy=y<yy?1:-1,e=dx+dy;
  for(int steps=0;steps<16385;++steps){pixel(x,y,c);if(x==xx&&y==yy)break;const int e2=e*2;if(e2>=dy){e+=dy;x+=sx;}if(e2<=dx){e+=dx;y+=sy;}}
}
void Runtime::text(const char* words,size_t length,int x,int baseline,int size,uint32_t c) {
  const Font* font=&fonts[0];for(const Font& f:fonts)if(f.size==size)font=&f;
  for(size_t i=0;i<length;) {
    uint32_t cp=uint8_t(words[i++]);
    if(cp>=0xc0){int n=cp<0xe0?1:cp<0xf0?2:3;cp&=(1u<<(6-n))-1;while(n--&&i<length)cp=(cp<<6)|(uint8_t(words[i++])&63);}
    const Glyph* glyph=nullptr;for(size_t j=0;j<font->count;++j)if(font->glyphs[j].code==cp){glyph=&font->glyphs[j];break;}
    if(!glyph)continue;
    for(int row=0;row<glyph->h;++row)for(int col=0;col<glyph->w;++col)
      pixel(x+glyph->x+col,baseline+glyph->y+row,c,font->alpha[glyph->offset+row*glyph->w+col]);
    x+=glyph->advance+font->tracking;
  }
}
}

extern "C" {
int mb_lua_chargestring(size_t len){
  mooboard::Runtime* r=mooboard::tRunning;
  if(!r||r->charge(mooboard::decodeWork(len)+1))return 1;
  r->overBudget();return 0;
}
void mb_lua_chargevalues(lua_State* l,int n){if(n>0&&!mooboard::owner(l)->charge(size_t(n)))luaL_error(l,"app exceeded its work budget");}
void* mb_runtime_new(){return new(std::nothrow)mooboard::Runtime();}
void mb_runtime_free(void* p){delete static_cast<mooboard::Runtime*>(p);}
int mb_runtime_load(void* p,const char* s,size_t n){return p&&static_cast<mooboard::Runtime*>(p)->load(s,n);}
int mb_runtime_json(void* p,const char* name,const char* s,size_t n){return p&&static_cast<mooboard::Runtime*>(p)->setJson(name,s,n);}
int mb_runtime_frame(void* p,const char* s,size_t n){return p&&static_cast<mooboard::Runtime*>(p)->frame(s,n);}
int mb_runtime_call(void* p,const char* s){return p&&static_cast<mooboard::Runtime*>(p)->call(s);}
const uint8_t* mb_runtime_pixels(void* p){return p?static_cast<mooboard::Runtime*>(p)->pixels():nullptr;}
const char* mb_runtime_error(void* p){return p?static_cast<mooboard::Runtime*>(p)->error():"no runtime";}
size_t mb_runtime_state(void* p,char* out,size_t capacity){if(!p)return 0;auto s=static_cast<mooboard::Runtime*>(p)->stateJson();if(out&&capacity>s.size())std::memcpy(out,s.c_str(),s.size()+1);return s.size();}
}
