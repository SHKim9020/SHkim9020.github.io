#include <cassert>
#include <cmath>
#include <cstdint>
#include <vector>
#include <utility>
#include <iostream>
constexpr uint8_t HIGH=1, LOW=0, OUTPUT=1, INPUT_PULLUP=2, NUM_DIGITAL_PINS=20;
uint8_t SREG=0x80;
uint32_t clockMs=0;
unsigned starts=0;
std::vector<std::pair<int,int>> waveform;
size_t pos=0;
int remaining=0;
bool capturing=false;
unsigned long millis(){return clockMs;}
void delay(unsigned long t){clockMs+=t;}
void delayMicroseconds(unsigned int){}
void noInterrupts(){SREG=0;}
void pinMode(uint8_t,uint8_t mode){if(mode==OUTPUT){++starts;capturing=false;}else {capturing=true;pos=0;remaining=waveform.empty()?0:waveform[0].second;}}
void digitalWrite(uint8_t,uint8_t){}
int digitalRead(uint8_t){
 if(!capturing || pos>=waveform.size()) return HIGH;
 int result=waveform[pos].first;
 if(--remaining==0){++pos;if(pos<waveform.size())remaining=waveform[pos].second;}
 return result;
}
#include "../firmware/onemaker_runtime/dht_reader.h"
void packet(std::vector<uint8_t> bytes, bool corrupt=false, bool releaseHigh=true){
 uint8_t sum=bytes[0]+bytes[1]+bytes[2]+bytes[3];bytes.push_back(sum+(corrupt?1:0));
 waveform.clear();if(releaseHigh)waveform.push_back({HIGH,4});
 waveform.push_back({LOW,20});waveform.push_back({HIGH,20});
 for(auto b:bytes)for(int bit=7;bit>=0;--bit){waveform.push_back({LOW,12});waveform.push_back({HIGH,(b&(1<<bit))?18:6});}
 waveform.push_back({LOW,12});
}
void near(float a,float b){assert(std::fabs(a-b)<0.01f);}
int main(){
 packet({55,0,24,0});near(readDhtValue(4,11,false),24);assert(SREG==0x80);
 unsigned n=starts;near(readDhtValue(4,11,true),55);near(readDhtValue(4,11,false),24);assert(starts==n);
 clockMs+=2000;packet({56,0,25,0},false,false);near(readDhtValue(4,11,false),25);
 clockMs+=2000;packet({56,0,25,0},true);near(readDhtValue(4,11,false),-999);assert(SREG==0x80);
 n=starts;near(readDhtValue(4,11,true),-999);assert(starts==n);
 clockMs+=2000;packet({56,0,26,0});near(readDhtValue(4,11,false),26);
 packet({2,43,128,123});near(readDhtValue(5,22,false),-12.3);near(readDhtValue(5,22,true),55.5);
 clockMs+=2000;waveform.clear();near(readDhtValue(4,11,false),-999);assert(SREG==0x80);
 n=starts;near(readDhtValue(255,11,false),-999);assert(starts==n);
 clockMs=0xFFFFFF00;packet({50,0,20,0});near(readDhtValue(4,11,false),20);
 clockMs+=500;n=starts;near(readDhtValue(4,11,true),50);assert(starts==n);
 clockMs+=1600;packet({51,0,21,0});near(readDhtValue(4,11,false),21);
 std::cout<<"DHT waveform, back-to-back reads, checksum, timeout, recovery, DHT22, rollover passed\n";
}
