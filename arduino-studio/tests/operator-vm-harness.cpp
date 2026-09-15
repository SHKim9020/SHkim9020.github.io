// Native harness for the actual firmware evaluator, injected by operators.test.js.
#include <cassert>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>
#include <algorithm>
#include <sstream>
#include <iomanip>
using std::min; using std::max; using std::isfinite;
struct String : std::string {
 using std::string::string;
 String(const std::string &s):std::string(s){}
 String(double v,int precision){std::ostringstream s;s<<std::fixed<<std::setprecision(precision)<<v;assign(s.str());}
 String substring(int a,int b)const{return substr(a,b-a);}
 bool endsWith(const char *s)const{auto n=std::string(s);return size()>=n.size()&&compare(size()-n.size(),n.size(),n)==0;}
 int indexOf(char c)const{auto p=find(c);return p==npos?-1:(int)p;}
 void remove(size_t p){erase(p);}
};
long random(long n){return n/2;}
long micros(){return 123;}
void randomSeed(long){}
// HELPERS
// ENUM
struct VmValue{float number=0;String text;bool isText=false;};
VmValue numberValue(float v){VmValue r;r.number=v;return r;}
VmValue textValue(String v){VmValue r;r.text=v;r.isText=true;return r;}
float valueNumber(const VmValue &v){if(!v.isText)return v.number;try{return std::stof(v.text);}catch(...){return 0;}}
bool valueBoolean(const VmValue &v){return v.isText?!v.text.empty():fabs(v.number)>0.00001f;}
String valueText(const VmValue &v){return v.isText?v.text:operatorText(v.number);}
std::vector<uint8_t> program;
uint8_t programByte(uint16_t i){return program.at(i);}
float programFloat(uint16_t &i){union{uint8_t b[4];float v;}x;for(auto &b:x.b)b=programByte(i++);return x.v;}
const int VM_MAX_STACK=8,VM_MAX_VARIABLES=8,A0=14,INPUT=0,HIGH=1;
float vmVariables[8]={};
long clampLong(long a,long lo,long hi){return min(hi,max(lo,a));}
#define constrain(a,b,c) clampLong(a,b,c)
int analogRead(int){return 512;} int digitalRead(int){return 1;} void pinMode(int,int){}
float readUltrasonic(int,int){return 10;} float readDhtValue(int,int,bool){return 23.8;} float readDust(int,int){return 5;}
String readBluetoothText(){return "ABC";}
struct Bt{void listen(){} int available(){return 0;}}; Bt *bluetooth=nullptr;
bool fetchHuskyValue(int,int,int16_t &){return false;}
float vmPower(float a,float b){return pow(a,b);}
// EVALUATOR
int main(){
 // FIXTURES
}
