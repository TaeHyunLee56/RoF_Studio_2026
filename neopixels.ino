 #include <FastLED.h>
 #include <BLEDevice.h>
 #include <BLEServer.h>
 #include <BLEUtils.h>
 #include <BLE2902.h>
 
 #define FASTLED_ALLOW_INTERRUPTS 0
 
 // Nordic UART Service UUID
 #define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
 #define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
 #define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
 
 #define NUM_STRIPS 6
 #define NUM_LEDS 200
 
 #define DATA_PIN_1 16
 #define DATA_PIN_2 17
 #define DATA_PIN_3 18
 #define DATA_PIN_4 25
 #define DATA_PIN_5 26
 #define DATA_PIN_6 27
 
 #define BRIGHTNESS 80
 
 #define START_LED 50
 #define END_LED 199
 
 #define LINE_SIZE 4
 uint8_t FADE_LEVEL[LINE_SIZE] = {255,100,20,5};
 
 #define MAX_LINES 20
 
 CRGB leds[NUM_STRIPS][NUM_LEDS];
 
 int heads[MAX_LINES];
 int active_lines = 0;
 
 int direction = 1;
 
 float FAST_DELAY = 2;   
 float SLOW_DELAY = 80;
 
 float START_DELAY = 40;
 float TARGET_DELAY = 50;
 
 float STEP_DELAY = 50;
 
 int MIN_GAP = 5;
 int MAX_GAP = 30;
 
 int spawn_gap = 10;
 
 unsigned long last_step = 0;
 unsigned long last_spawn = 0;
 
 enum Mode { NORMAL, ACCEL, DECEL, OFF };
 Mode mode = NORMAL;
 
 unsigned long mode_start;
 
 #define ACCEL_DURATION 12000
 #define DECEL_DURATION 6000
 
 volatile char blePendingCmd = 0;
 
 BLEServer* pServer = nullptr;
 BLECharacteristic* pTxCharacteristic = nullptr;
 
 bool deviceConnected = false;
 bool wasConnected = false;
 
 
 
 class LedCallbacks : public BLECharacteristicCallbacks {
 public:
     void onWrite(BLECharacteristic* pCharacteristic) {
 
         String value = pCharacteristic->getValue();
 
         if(value.length() > 0){
             blePendingCmd = value[0];
         }
     }
 };
 
 
 
 class ServerCallbacks : public BLEServerCallbacks {
 
     void onConnect(BLEServer* pServer){
         deviceConnected = true;
     }
 
     void onDisconnect(BLEServer* pServer){
         deviceConnected = false;
     }
 
 };
 
 
 
 void spawn_line(){
 
     if(active_lines < MAX_LINES){
 
         if(direction == 1)
             heads[active_lines] = START_LED;
         else
             heads[active_lines] = END_LED;
 
         active_lines++;
 
     }
 }
 
 
 
 void remove_line(int index){
 
     for(int i=index;i<active_lines-1;i++)
         heads[i] = heads[i+1];
 
     active_lines--;
 
 }
 
 
 
 void blackout(){
 
     active_lines = 0;
 
     for(int s=0;s<NUM_STRIPS;s++)
         fill_solid(leds[s], NUM_LEDS, CRGB::Black);
 
     FastLED.show();
     yield();
 
 }
 
 
 
 void setup(){
 
     Serial.begin(115200);
 
     BLEDevice::init("ESP32_LED");
 
     pServer = BLEDevice::createServer();
     pServer->setCallbacks(new ServerCallbacks());
 
     BLEService *pService = pServer->createService(SERVICE_UUID);
 
 
     BLECharacteristic *pRxCharacteristic =
         pService->createCharacteristic(
             CHARACTERISTIC_UUID_RX,
             BLECharacteristic::PROPERTY_WRITE
         );
 
     pRxCharacteristic->setCallbacks(new LedCallbacks());
 
 
     pTxCharacteristic =
         pService->createCharacteristic(
             CHARACTERISTIC_UUID_TX,
             BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ
         );
 
     pTxCharacteristic->addDescriptor(new BLE2902());
 
     pService->start();
 
 
     BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
 
     pAdvertising->addServiceUUID(SERVICE_UUID);
     pAdvertising->setScanResponse(true);
 
     BLEDevice::startAdvertising();
 
 
     FastLED.setMaxPowerInVoltsAndMilliamps(5,20000);
 
     FastLED.addLeds<WS2812, DATA_PIN_1, GRB>(leds[0], NUM_LEDS);
     FastLED.addLeds<WS2812, DATA_PIN_2, GRB>(leds[1], NUM_LEDS);
     FastLED.addLeds<WS2812, DATA_PIN_3, GRB>(leds[2], NUM_LEDS);
     FastLED.addLeds<WS2812, DATA_PIN_4, GRB>(leds[3], NUM_LEDS);
     FastLED.addLeds<WS2812, DATA_PIN_5, GRB>(leds[4], NUM_LEDS);
     FastLED.addLeds<WS2812, DATA_PIN_6, GRB>(leds[5], NUM_LEDS);
 
     FastLED.setBrightness(BRIGHTNESS);
 
 }
 
 
 
 void update_speed(){
 
     float duration = (mode == ACCEL) ? ACCEL_DURATION : DECEL_DURATION;
 
     float t = (millis() - mode_start) / (float)duration;
 
     if(t > 1.0) t = 1.0;
 
 
     STEP_DELAY = START_DELAY + (TARGET_DELAY - START_DELAY) * t;
 
     spawn_gap = MAX_GAP + (int)((MIN_GAP - MAX_GAP) * t);
 
 
     if(t >= 1.0){
 
         blackout();
         mode = OFF;
 
     }
 
 }
 
 
 
 void loop(){
 
     if(wasConnected && !deviceConnected){
 
         delay(500);
 
         pServer->startAdvertising();
 
         wasConnected = false;
 
     }
 
     if(deviceConnected) wasConnected = true;
 
 
 
     if(blePendingCmd){
 
         char cmd = blePendingCmd;
         blePendingCmd = 0;
 
 
         if(cmd=='i'){
 
             direction = 1;
 
             START_DELAY = STEP_DELAY;
             TARGET_DELAY = FAST_DELAY;
 
             mode = ACCEL;
 
             mode_start = millis();
 
         }
 
         else if(cmd=='o'){
 
             direction = -1;
 
             START_DELAY = STEP_DELAY;
             TARGET_DELAY = SLOW_DELAY;
 
             mode = DECEL;
 
             mode_start = millis();
 
         }
 
         else if(cmd=='x'){
 
             mode = OFF;
             blackout();
 
         }
 
     }
 
 
     if(mode==OFF) return;
 
 
     update_speed();
 
 
     if(millis()-last_step < STEP_DELAY) return;
 
     last_step = millis();
 
 
     if(millis()-last_spawn > (unsigned long)(spawn_gap * STEP_DELAY)){
 
         spawn_line();
         last_spawn = millis();
 
     }
 
 
     for(int s=0;s<NUM_STRIPS;s++)
         fill_solid(&leds[s][START_LED], END_LED-START_LED+1, CRGB::Black);
 
 
 
     for(int n=0;n<active_lines;n++){
 
         for(int j=0;j<LINE_SIZE;j++){
 
             int idx = heads[n] - j*direction;
 
             if(idx>=START_LED && idx<=END_LED){
 
                 uint8_t v = FADE_LEVEL[j];
 
                 for(int s=0;s<NUM_STRIPS;s++)
                     leds[s][idx] = CRGB(v,v,v);
 
             }
 
         }
 
     }
 
 
 
     FastLED.show();
 
     yield();
 
 
 
     for(int n=0;n<active_lines;n++)
         heads[n]+=direction;
 
 
 
     int n=0;
 
     while(n<active_lines){
 
         if(direction==1){
 
             if(heads[n]-(LINE_SIZE-1) > END_LED){
 
                 remove_line(n);
                 continue;
 
             }
 
         }
 
         else{
 
             if(heads[n]+(LINE_SIZE-1) < START_LED){
 
                 remove_line(n);
                 continue;
 
             }
 
         }
 
         n++;
 
     }
 
 }