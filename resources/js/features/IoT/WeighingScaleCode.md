/* ช่วยแก้ไขไฟล์นี้ถ้ามีสิ่งที่ต้องแก้ไข จะ Copy ไปอัปโหลดลง Code */
/*
  ESP32 Weighing Scale Controller
  ─────────────────────────────────────────────────────────────────────
  Hardware:
  - LCD 20x4 I2C (SDA=21, SCL=22)
  - Scale serial (UART2, RX=16, TX=17, 2400 baud)
  - BTN_GREEN (GPIO 32) = ของดี
  - BTN_RED   (GPIO 33) = ของเสีย
  - Keypad membrane 4x4

  Keypad wiring (8 สาย — ต่อกับ ESP32 Dev Module):
  ┌──────────────┬────────────┐
  │ สายคีย์แพด   │ GPIO ESP32 │
  ├──────────────┼────────────┤
  │ สาย 1  (R1) │  GPIO 13   │
  │ สาย 2  (R2) │  GPIO 14   │
  │ สาย 3  (R3) │  GPIO 27   │
  │ สาย 4  (R4) │  GPIO 26   │
  │ สาย 5  (C1) │  GPIO 18   │
  │ สาย 6  (C2) │  GPIO 19   │
  │ สาย 7  (C3) │  GPIO 23   │
  │ สาย 8  (C4) │  GPIO 25   │
  └──────────────┴────────────┘

  Layout ปุ่มบน Keypad:
  ┌───┬───┬───┬───┐
  │ 1 │ 2 │ 3 │ A │ ← กะ A
  │ 4 │ 5 │ 6 │ B │ ← กะ B
  │ 7 │ 8 │ 9 │ C │ ← กะ C
  │ * │ 0 │ # │ D │ ← # ลบทีละตัว / D ยืนยัน
  └───┴───┴───┴───┘

  State Machine (ใช้คำนำหน้า ST_ เพื่อไม่ชนกับ KeyState::IDLE ใน Keypad.h):
  ST_IDLE → รอคำสั่งจากเว็บ (poll ทุก 3 วินาที)
  ST_WAIT_SHIFT → รับงานแล้ว รอกด A/B/C เลือกกะ
  ST_WAIT_EMPLOYEE → รอพิมพ์รหัสพนักงาน (max 14 หลัก) + D ยืนยัน
  ST_CONFIRMING → กำลังส่งยืนยันไป server (รอครู่เดียว)
  ST_PRODUCTION → ผลิต: อ่านน้ำหนัก / กด BTN_GREEN ส่งของดี

  Dependencies (Library Manager):
  - LiquidCrystal I2C (by Frank de Brabander)
  - Keypad             (by Mark Stanley, Alexander Brevig)
  - ArduinoJson        (by Benoit Blanchon)
  - Preferences          (ESP32 NVS — built-in)

  หลังไฟดับ / reboot:
  - เก็บสถานะผลิต (รหัสสินค้า กะ พนักงาน Order ...) ใน NVS
  - เปิดไฟใหม่แล้วกลับหน้าผลิตทันที พร้อมรับน้ำหนักจากตาชั่งและส่งไปเว็บ/ป้ายไฟ
  - เว็บซิงค์ `/scale-live` เพื่อบอกว่ายัง Live — ถ้าจบงานแล้วตาชั่งจะล้าง NVS กลับ IDLE
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Keypad.h>
#include <Preferences.h>
#include <time.h>

// ======================================================================
//  ⚙️  ปรับค่าตรงนี้ก่อน upload ทุกชุด
// ======================================================================
#define MACHINE_ID  "EM 21"   // รหัสเครื่อง (ต้องตรงกับ Machine ID ในชีต Settings)

struct WifiProfile {
  const char* ssid;
  const char* pass;
  const char* serverUrl;  // https://www.chaiyo-factory.com — server หลัก (เดียวกันทุก network)
};

// AP-Office และ KANOK-AP route ถึงกันได้ → ใช้ server URL เดียวกันทุก network
const WifiProfile WIFI_PROFILES[] = {
  { "AP-Office", "Info2024",   "https://www.chaiyo-factory.com" },
  { "KANOK-AP",  "kanok2564",  "https://www.chaiyo-factory.com" },
};
const int WIFI_PROFILE_COUNT = sizeof(WIFI_PROFILES) / sizeof(WIFI_PROFILES[0]);
// ======================================================================

// ─── Hardware ──────────────────────────────────────────────────────────
LiquidCrystal_I2C lcd(0x27, 20, 4);

#define RXD2      16
#define TXD2      17
#define BTN_GREEN 32
#define BTN_RED   33

// ─── Keypad 4x4 ────────────────────────────────────────────────────────
const byte KEYPAD_ROWS = 4;
const byte KEYPAD_COLS = 4;
char keys[KEYPAD_ROWS][KEYPAD_COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[KEYPAD_ROWS] = {13, 14, 27, 26};
byte colPins[KEYPAD_COLS]  = {18, 19, 23, 25};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, KEYPAD_ROWS, KEYPAD_COLS);

// ─── State Machine (ชื่อไม่ใช้ IDLE — ชนกับ Keypad KeyState::IDLE) ───────
enum ScaleState {
  ST_IDLE,
  ST_WAIT_SHIFT,
  ST_WAIT_EMPLOYEE,
  ST_CONFIRMING,
  ST_PRODUCTION
};
ScaleState g_state = ST_IDLE;

// ─── Job Data ──────────────────────────────────────────────────────────
String g_orderId     = "";
String g_productCode = "";
String g_sheetName   = "";
int    g_targetQty   = 0;
char   g_shift       = 0;    // 'A', 'B', or 'C'
String g_employeeId  = "";
int    g_actualCount = 0;

// ─── Product details (จาก scale-command / scale-live) ──────────────────
float  g_stdWeight  = 0;     // น้ำหนักมาตรฐาน (kg)
float  g_minWeight  = 0;     // Min weight (kg)
float  g_maxWeight  = 0;     // Max weight (kg)
int    g_productLen = 0;     // ความยาว (m)

// ─── Scale & display ───────────────────────────────────────────────────
String g_liveWeight = "0.00";
String g_lastStatus = "";    // ข้อความที่แสดงบรรทัด 3 ("OK - X kg." / "NG - X kg.")

// ─── Employee ID — กรอกได้สูงสุด MAX_EMP หลัก (LCD 20 cols - "EmpID:" 6 cols = 14) ─
#define MAX_EMP 14

// ─── Button lockout (ป้องกันกดซ้ำใน 5 วินาที) ─────────────────────────
unsigned long g_btnLockUntil = 0;          // millis ที่ lock จะหมด (0 = ไม่ล็อก)
const unsigned long BTN_LOCK_MS = 5000;    // 5 วินาที

// ─── Offline event queue (กดปุ่มตอน WiFi หลุด → เก็บไว้ flush ทีหลัง) ─
struct PendingEvent {
  String type;       // "good" | "ng"
  String weight;
  String pressedAt;  // ISO8601 เวลาที่กดปุ่ม
};
// MAX_PENDING = 200 รองรับการกดปุ่มต่อเนื่องตลอดกะ 8 ชั่วโมงโดยไม่มี WiFi
// (สมมติกด ~25 ครั้ง/ชั่วโมง × 8 ชั่วโมง = 200 events)
const int MAX_PENDING = 200;
PendingEvent g_pending[MAX_PENDING];
int g_pendingCount = 0;

// ─── Confirm retry state ──────────────────────────────────────────────
// ไม่ใช้ global retry counter — sendConfirmToServer() เรียกตัวเองซ้ำโดยตรง

// ─── WiFi / Network ────────────────────────────────────────────────────
String g_serverUrl = "";
bool   g_wifiOk    = false;

unsigned long g_lastPollMs  = 0;
const  int    POLL_INTERVAL = 3000;   // ms — poll ทุก 3 วินาที

// ─── WiFi reconnect exponential backoff ─────────────────────────────────
// เริ่ม 2 วินาที → สองเท่าทุกรอบ → สูงสุด 60 วินาที (± 20% jitter)
// ป้องกัน ESP32 ping server ถี่เกินช่วง outage ยาว
unsigned long g_wifiBackoffMs        = 2000;
unsigned long g_lastWifiRetryMs      = 0;
const  unsigned long WIFI_BACKOFF_MIN = 2000;
const  unsigned long WIFI_BACKOFF_MAX = 60000;

// คืนค่า backoff ถัดไปพร้อม ±20% jitter
unsigned long nextWifiBackoff(unsigned long cur) {
  unsigned long next = min(cur * 2, WIFI_BACKOFF_MAX);
  long jitter = (long)(next * 0.2f) * (((long)random(0, 200) - 100) / 100.0f);
  return (unsigned long)max((long)WIFI_BACKOFF_MIN, (long)next + jitter);
}

// ─── qty remaining / good — อัปเดตจาก HTTP response หลังส่งน้ำหนัก ───
int g_qtyRemaining = -1;  // -1 = ยังไม่รู้ (ยังไม่ได้รับจาก server)
int g_qtyGood      = -1;

// ─── Forward declarations ──────────────────────────────────────────────
void renderLcd();
void handleKeypad(char key);
void pollJobFromServer();
void sendConfirmToServer();
void sendWeightToServer(const String& type);
void flushPendingEvents();
void enterState(ScaleState s);
void enterProductionFresh();
void saveProductionSession();
void clearProductionNvs();
bool loadProductionSessionFromNVS();
bool syncWithScaleLive();
void pollScaleLiveFromServer();
String getIsoTime();

// ======================================================================
//  WiFi — สแกนแล้วเลือก SSID ที่ RSSI ดีที่สุด
// ======================================================================
void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(300);

  Serial.println("[WiFi] Scanning...");
  int n = WiFi.scanNetworks();
  int bestProfile = -1;
  int bestRssi    = -9999;

  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    int    rssi = WiFi.RSSI(i);
    for (int p = 0; p < WIFI_PROFILE_COUNT; p++) {
      if (ssid == WIFI_PROFILES[p].ssid && rssi > bestRssi) {
        bestProfile = p;
        bestRssi    = rssi;
      }
    }
  }
  WiFi.scanDelete();

  if (bestProfile < 0) {
    Serial.println("[WiFi] ไม่พบ WiFi ที่รู้จัก");
    g_wifiOk = false;
    return;
  }

  const WifiProfile& prof = WIFI_PROFILES[bestProfile];
  g_serverUrl = String(prof.serverUrl);
  WiFi.begin(prof.ssid, prof.pass);

  Serial.printf("[WiFi] กำลังเชื่อม %s ...\n", prof.ssid);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 24) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();

  g_wifiOk = (WiFi.status() == WL_CONNECTED);
  if (g_wifiOk) {
    Serial.println("[WiFi] ✓ " + WiFi.localIP().toString());
    Serial.println("[WiFi] Server: " + g_serverUrl);
    // ซิงค์เวลาจาก NTP (UTC+7 Bangkok)
    configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com");
    // รอให้เวลาตั้งค่าเสร็จ (สูงสุด 3 วินาที)
    struct tm timeinfo;
    int ntpRetry = 0;
    while (!getLocalTime(&timeinfo, 500) && ntpRetry < 6) { ntpRetry++; }
    if (ntpRetry < 6) {
      char buf[32];
      strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
      Serial.println("[NTP] Synced: " + String(buf));
    } else {
      Serial.println("[NTP] Sync timeout — using internal RTC");
    }
  } else {
    Serial.println("[WiFi] FAILED");
  }
}

// ======================================================================
//  getIsoTime — คืน ISO8601 string ของเวลาปัจจุบัน (UTC+7)
//  หลัง NTP sync แล้ว ESP32 RTC จะเดินต่อเองแม้ WiFi หลุด
// ======================================================================
String getIsoTime() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 0)) {
    // NTP ยังไม่เคย sync: คืน millis แทนให้ server รู้ว่า fallback
    return "millis:" + String(millis());
  }
  char buf[30];
  // รูปแบบ: 2026-04-27T14:30:05+07:00
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S+07:00", &timeinfo);
  return String(buf);
}

// ======================================================================
//  NVS — กู้สถานะผลิตหลังไฟดับ
// ======================================================================
void clearProductionNvs() {
  Preferences prefs;
  prefs.begin("prodmon", false);
  prefs.clear();
  prefs.end();
}

void saveProductionSession() {
  if (g_state != ST_PRODUCTION) return;
  Preferences prefs;
  prefs.begin("prodmon", false);
  prefs.putBool("active", true);
  prefs.putString("oid", g_orderId);
  prefs.putString("pcode", g_productCode);
  prefs.putString("sheet", g_sheetName);
  prefs.putInt("targ", g_targetQty);
  prefs.putUChar("shift", (unsigned char)g_shift);
  prefs.putString("emp", g_employeeId);
  prefs.putUInt("actual", (unsigned)g_actualCount);
  // qty counters — ป้องกัน reboot ทำให้แสดง qty เก่า
  prefs.putInt("qtyGood", g_qtyGood);
  prefs.putInt("qtyRem",  g_qtyRemaining);
  // ข้อมูลผลิตภัณฑ์ (สำหรับแสดง LCD หลัง reboot)
  prefs.putFloat("stdW", g_stdWeight);
  prefs.putFloat("minW", g_minWeight);
  prefs.putFloat("maxW", g_maxWeight);
  prefs.putInt("plen", g_productLen);
  prefs.end();
}

bool loadProductionSessionFromNVS() {
  Preferences prefs;
  prefs.begin("prodmon", true);
  if (!prefs.getBool("active", false)) {
    prefs.end();
    return false;
  }
  g_orderId      = prefs.getString("oid", "");
  g_productCode  = prefs.getString("pcode", "");
  g_sheetName    = prefs.getString("sheet", "");
  g_targetQty    = prefs.getInt("targ", 0);
  g_shift        = (char)prefs.getUChar("shift", 0);
  g_employeeId   = prefs.getString("emp", "");
  g_actualCount  = (int)prefs.getUInt("actual", 0);
  g_qtyGood      = prefs.getInt("qtyGood", -1);
  g_qtyRemaining = prefs.getInt("qtyRem",  -1);
  g_stdWeight    = prefs.getFloat("stdW", 0);
  g_minWeight    = prefs.getFloat("minW", 0);
  g_maxWeight    = prefs.getFloat("maxW", 0);
  g_productLen   = prefs.getInt("plen", 0);
  prefs.end();

  if (g_orderId.length() == 0 || g_shift == 0 || g_employeeId.length() == 0) {
    clearProductionNvs();
    return false;
  }
  g_state       = ST_PRODUCTION;
  g_lastStatus  = "-";
  g_liveWeight  = "0.00";
  Serial.printf("[NVS] Restored: %s  %c  %s  actual=%d\n",
    g_orderId.c_str(), g_shift, g_employeeId.c_str(), g_actualCount);
  return true;
}

// เริ่มหน้า PRODUCTION แบบงานใหม่ (รีเซ็ต actual กะ/เว็บรอ command ก่อน)
void enterProductionFresh() {
  g_state = ST_PRODUCTION;
  g_actualCount = 0;
  g_lastStatus  = "-";
  g_liveWeight  = "0.00";
  saveProductionSession();
  renderLcd();
}

// ──────────────────────────────────────────────────────────────────────────────
//  syncWithScaleLive — ดึง session จากเว็บ แล้วซิงค์ทั้งสองทิศทาง
//  • ST_IDLE + live=true   → restore session → ST_PRODUCTION (WiFi กลับมา / เปิดไฟใหม่)
//  • ST_PRODUCTION + live=false → clear NVS → ST_IDLE   (เว็บ Pause/จบงาน)
//  • live=null → เว็บยังไม่ sync (ไม่ทำอะไร)
//  ผลตอบแทน: true ถ้ามีการเปลี่ยน state
// ──────────────────────────────────────────────────────────────────────────────
bool syncWithScaleLive() {
  if (!g_wifiOk || g_serverUrl.isEmpty()) return false;
  if (g_state != ST_IDLE && g_state != ST_PRODUCTION) return false;

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/scale-live/" + mid;
  http.begin(url);
  http.setTimeout(5000);
  int code = http.GET();
  if (code != 200) { http.end(); return false; }

  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) return false;

  JsonVariant lv = doc["live"];
  if (lv.isNull()) return false;   // เว็บยังไม่ sync — อย่าเปลี่ยน state

  bool webIsLive = lv.as<bool>();

  // ── PRODUCTION + เว็บบอก false → กลับ IDLE ──────────────────────────────
  if (g_state == ST_PRODUCTION && !webIsLive) {
    Serial.println("[Scale] /scale-live=false → clear NVS → IDLE");
    clearProductionNvs();
    enterState(ST_IDLE);
    return true;
  }

  // ── PRODUCTION + เว็บบอก live=true → refresh weights ถ้าหาย ──────────────
  // ป้องกัน LCD แสดง "---" เมื่อ g_stdWeight/minWeight/maxWeight/productLen
  // ถูก reset เป็น 0 โดยไม่ทราบสาเหตุ (เช่น NVS เก่า / JSON truncation)
  if (g_state == ST_PRODUCTION && webIsLive) {
    float sw = doc["stdWeight"] | 0.0f;
    float mn = doc["minWeight"] | 0.0f;
    float mx = doc["maxWeight"] | 0.0f;
    int   pl = doc["productLen"] | 0;
    bool  refreshed = false;
    if (sw > 0 && g_stdWeight  == 0) { g_stdWeight  = sw; refreshed = true; }
    if (mn > 0 && g_minWeight  == 0) { g_minWeight  = mn; refreshed = true; }
    if (mx > 0 && g_maxWeight  == 0) { g_maxWeight  = mx; refreshed = true; }
    if (pl > 0 && g_productLen == 0) { g_productLen = pl; refreshed = true; }
    if (refreshed) {
      Serial.println("[Scale] Weight recovered from /scale-live → redraw LCD");
      saveProductionSession();
      renderLcd();
    }
    return false;  // ไม่เปลี่ยน state
  }

  // ── IDLE + เว็บบอก live=true → restore session ───────────────────────────
  if (g_state == ST_IDLE && webIsLive) {
    String oid   = doc["orderId"]     | "";
    String pcode = doc["productCode"] | "";
    String sheet = doc["sheetName"]   | "";
    int    tqty  = doc["targetQty"]   | 0;
    String shiftStr  = doc["shift"]      | "";
    String emp   = doc["employeeId"]  | "";

    // ต้องมีข้อมูลขั้นต่ำ: orderId + shift + employeeId
    if (oid.length() == 0 || shiftStr.length() == 0 || emp.length() == 0) {
      Serial.println("[Scale] /scale-live=true แต่ข้อมูล session ไม่ครบ — รอต่อไป");
      return false;
    }

    g_orderId     = oid;
    g_productCode = pcode;
    g_sheetName   = sheet;
    g_targetQty   = tqty;
    g_shift       = shiftStr.charAt(0);   // 'A', 'B', or 'C'
    g_employeeId  = emp;
    g_actualCount = (int)(doc["pipeCounter"] | 0);
    // weight fields: ใช้ค่าจาก server ถ้า > 0 ไม่ก็ fallback NVS (ป้องกัน server ส่ง 0)
    float sw = doc["stdWeight"] | 0.0f;
    float mn = doc["minWeight"] | 0.0f;
    float mx = doc["maxWeight"] | 0.0f;
    int   pl = doc["productLen"] | 0;
    if (sw > 0) g_stdWeight  = sw;
    if (mn > 0) g_minWeight  = mn;
    if (mx > 0) g_maxWeight  = mx;
    if (pl > 0) g_productLen = pl;
    g_lastStatus  = "-";
    g_liveWeight  = "0.00";

    g_state = ST_PRODUCTION;   // ข้ามขั้นตอน shift/employee เพราะได้จากเว็บแล้ว
    saveProductionSession();
    renderLcd();
    Serial.printf("[Scale] /scale-live=true → restored: %s %c %s\n",
      g_orderId.c_str(), g_shift, g_employeeId.c_str());
    return true;
  }

  return false;
}

// compat alias ใช้ใน loop เดิม
void pollScaleLiveFromServer() { syncWithScaleLive(); }

// ======================================================================
//  setup
// ======================================================================
void setup() {
  Serial.begin(115200);
  Serial2.begin(2400, SERIAL_8N1, RXD2, TXD2);
  Serial2.setTimeout(20);

  pinMode(BTN_GREEN, INPUT_PULLUP);
  pinMode(BTN_RED,   INPUT_PULLUP);

  lcd.init();
  lcd.backlight();

  // ── 1. ลอง restore จาก NVS ก่อน (เร็วสุด — ไม่ต้องรอ WiFi) ──────────────
  bool nvsRestored = loadProductionSessionFromNVS();

  // ── 2. ต่อ WiFi + NTP ─────────────────────────────────────────────────────
  if (nvsRestored) {
    // แสดง LCD ก่อนรอ WiFi ทันที ไม่ต้องให้ผู้ใช้รอนาน
    renderLcd();
    lcd.setCursor(0, 3); lcd.print("WiFi connecting...  ");
  }
  connectWifi();

  // ── 3. sync กับ /scale-live เสมอ (ทั้ง NVS restored และไม่ restored)
  //    เว็บเป็น source of truth — ถ้าเว็บบอก live=false → clear NVS → IDLE
  //    ป้องกันตาชั่งค้างหน้า Production ทั้งที่เว็บไม่มีงานแล้ว
  if (g_wifiOk) {
    bool serverSynced = syncWithScaleLive();
    if (serverSynced) {
      Serial.println("[Scale] Boot: synced from /scale-live");
      if (g_state == ST_PRODUCTION && g_pendingCount > 0) flushPendingEvents();
      return;
    }
  }

  // ── 4. sync ไม่ได้ (server ไม่ตอบ / live=null) → ใช้ NVS ถ้ามี ──────────
  if (nvsRestored) {
    renderLcd();
    Serial.println("[Scale] Boot: server unreachable — resumed PRODUCTION from NVS");
    if (g_pendingCount > 0) flushPendingEvents();
    return;
  }

  // ── 5. ไม่มี session ใดๆ → IDLE ──────────────────────────────────────────
  enterState(ST_IDLE);
}

// ======================================================================
//  enterState — เปลี่ยน state พร้อม reset ตัวแปร + redraw LCD
// ======================================================================
void enterState(ScaleState s) {
  g_state = s;
  switch (s) {
    case ST_IDLE:
      clearProductionNvs();
      g_orderId = ""; g_productCode = ""; g_sheetName = "";
      g_targetQty = 0; g_shift = 0; g_employeeId = "";
      g_actualCount = 0; g_lastStatus = "-";
      break;
    case ST_WAIT_EMPLOYEE:
      g_employeeId = "";
      break;
    default: break;
  }
  renderLcd();
}

// ======================================================================
//  ตัดเลข 0 ท้ายทศนิยม: "15.20"→"15.2" / "15.00"→"15" / "15.28"→"15.28"
// ======================================================================
String trimWeight(const String& w) {
  if (w.indexOf('.') < 0) return w;
  String s = w;
  while (s.endsWith("0")) s.remove(s.length() - 1);
  if (s.endsWith("."))    s.remove(s.length() - 1);
  return s;
}
// สำหรับ float (max 2 decimals แล้ว trim)
String fmtFloat(float val) {
  return trimWeight(String(val, 2));
}

// ======================================================================
//  renderLcd — วาด LCD ใหม่ทั้งหมดตาม state
// ======================================================================
void renderLcd() {
  lcd.clear();

  if (g_state == ST_IDLE) {
    lcd.setCursor(0, 0); lcd.print(MACHINE_ID);
    lcd.setCursor(0, 1); lcd.print(g_wifiOk ? "WiFi: OK" : "WiFi: No Network");
    lcd.setCursor(0, 2); lcd.print("Waiting command...");
  }

  else if (g_state == ST_WAIT_SHIFT) {
    // บรรทัด 0: รหัสสินค้า (max 20 ตัว)
    lcd.setCursor(0, 0); lcd.print(g_productCode.substring(0, 20));
    // บรรทัด 1: เลขใบขอ
    String orderLine = "Order: " + g_orderId;
    lcd.setCursor(0, 1); lcd.print(orderLine.substring(0, 20));
    // บรรทัด 2: เลือกกะ
    lcd.setCursor(0, 2); lcd.print("Shift: Press A/B/C");
    // บรรทัด 3: จำนวนเป้า
    lcd.setCursor(0, 3); lcd.print("Target: " + String(g_targetQty));
  }

  else if (g_state == ST_WAIT_EMPLOYEE) {
    lcd.setCursor(0, 0); lcd.print(g_productCode.substring(0, 20));
    // บรรทัด 1: กะที่เลือก
    lcd.setCursor(0, 1); lcd.print("Shift: "); lcd.print(g_shift);
    // บรรทัด 2: รหัสพนักงาน (กรอกได้สูงสุด MAX_EMP หลัก)
    lcd.setCursor(0, 2);
    lcd.print("EmpID:");
    lcd.print(g_employeeId);
    if ((int)g_employeeId.length() < MAX_EMP) lcd.print("_");
    // บรรทัด 3: คำแนะนำ
    lcd.setCursor(0, 3); lcd.print("# Del   D Confirm");
  }

  else if (g_state == ST_CONFIRMING) {
    lcd.setCursor(0, 0); lcd.print("Confirming...");
    lcd.setCursor(0, 1); lcd.print("Please wait...");
  }

  else if (g_state == ST_PRODUCTION) {
    // บรรทัด 0: รหัสสินค้า (เหมือนเดิม)
    lcd.setCursor(0, 0); lcd.print(g_productCode.substring(0, 20));

    // บรรทัด 1: น้ำหนักมาตรฐาน & ความยาว  เช่น "W 15 kg & L 200 m"
    if (g_stdWeight > 0 || g_productLen > 0) {
      String line1 = "W " + fmtFloat(g_stdWeight) + " kg & L " + String(g_productLen) + " m";
      lcd.setCursor(0, 1); lcd.print(line1.substring(0, 20));
    } else {
      lcd.setCursor(0, 1); lcd.print("---");
    }

    // บรรทัด 2: Min - Max  เช่น "Min 14.8 - Max 15.5"
    if (g_minWeight > 0 || g_maxWeight > 0) {
      String line2 = "Min " + fmtFloat(g_minWeight) + " - Max " + fmtFloat(g_maxWeight);
      lcd.setCursor(0, 2); lcd.print(line2.substring(0, 20));
    } else {
      lcd.setCursor(0, 2); lcd.print("---");
    }

    // บรรทัด 3: แสดง status เฉพาะช่วง lock (5 วิ) — ปกติว่างเปล่า
    lcd.setCursor(0, 3);
    if (g_btnLockUntil > 0 && millis() < g_btnLockUntil) {
      String statusLine = g_lastStatus;
      while (statusLine.length() < 20) statusLine += ' ';
      lcd.print(statusLine);
    }
    // else: ว่างเปล่า
  }
}

// ======================================================================
//  handleKeypad — ประมวลผลปุ่มที่กด
// ======================================================================
void handleKeypad(char key) {

  if (g_state == ST_WAIT_SHIFT) {
    if (key == 'A' || key == 'B' || key == 'C') {
      g_shift = key;
      enterState(ST_WAIT_EMPLOYEE);
    }
  }

  else if (g_state == ST_WAIT_EMPLOYEE) {
    if (key == '#') {
      // ลบตัวสุดท้าย
      if (g_employeeId.length() > 0) {
        g_employeeId.remove(g_employeeId.length() - 1);
        lcd.setCursor(0, 2);
        lcd.print("                    ");
        lcd.setCursor(0, 2);
        lcd.print("EmpID:");
        lcd.print(g_employeeId);
        if ((int)g_employeeId.length() < MAX_EMP) lcd.print("_");
      }
    }
    else if (key == 'D') {
      // ยืนยัน — ต้องมีรหัสพนักงานอย่างน้อย 1 ตัว
      if (g_employeeId.length() > 0) {
        enterState(ST_CONFIRMING);
        sendConfirmToServer();
      }
    }
    else if (isDigit(key) && (int)g_employeeId.length() < MAX_EMP) {
      g_employeeId += key;
      lcd.setCursor(0, 2);
      lcd.print("                    ");
      lcd.setCursor(0, 2);
      lcd.print("EmpID:");
      lcd.print(g_employeeId);
      if ((int)g_employeeId.length() < MAX_EMP) lcd.print("_");
    }
  }
}

// ======================================================================
//  pollJobFromServer — IDLE เท่านั้น: ดึงงานจาก Laravel
//  GET /api/production-monitor/scale-command/{MACHINE_ID}
// ======================================================================
void pollJobFromServer() {
  if (!g_wifiOk || g_serverUrl.isEmpty()) return;
  if (g_state != ST_IDLE) return;

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/scale-command/" + mid;

  http.begin(url);
  http.setTimeout(4000);
  int code = http.GET();

  if (code == 200) {
    StaticJsonDocument<1024> doc;
    if (!deserializeJson(doc, http.getString())) {
      if (doc["pending"].as<bool>()) {
        g_orderId     = doc["orderId"].as<String>();
        g_productCode = doc["productCode"].as<String>();
        g_targetQty   = doc["targetQty"].as<int>();
        g_sheetName   = doc["sheetName"].as<String>();
        // รับ weight fields เฉพาะที่ > 0 (ป้องกัน server ส่ง 0 overwrite ค่าเดิม)
        float sw2 = doc["stdWeight"] | 0.0f;
        float mn2 = doc["minWeight"] | 0.0f;
        float mx2 = doc["maxWeight"] | 0.0f;
        int   pl2 = doc["productLen"] | 0;
        // ใช้ค่าจาก server ถ้า > 0 — ถ้า server ส่ง 0 ให้ reset เป็น 0 เท่านั้น
        // (งานใหม่ อาจยังไม่มีข้อมูล — จะ refresh จาก syncWithScaleLive ภายหลัง)
        g_stdWeight  = sw2;
        g_minWeight  = mn2;
        g_maxWeight  = mx2;
        g_productLen = pl2;
        Serial.println("[Scale] งานใหม่: " + g_orderId + " / " + g_productCode);
        enterState(ST_WAIT_SHIFT);
      }
    }
  } else if (code > 0) {
    Serial.printf("[Scale] Poll HTTP %d\n", code);
  }
  http.end();
}

// ======================================================================
//  sendConfirmToServer — กด D แล้ว: POST กะ + รหัสพนักงาน
//
//  ส่งไป 2 endpoint พร้อมกัน:
//  1. POST /api/production-monitor/scale-confirm/{id}  — legacy polling
//  2. POST /api/production-monitor/session-confirm/{id} — NEW: triggers SSE
//     broadcast 'session_confirmed' ไปยัง browser ทุกตัวในเครือข่าย
//
//  Payload: { shift, employee_id, confirmed_at }
// ======================================================================
void sendConfirmToServer() {
  if (!g_wifiOk) {
    // Offline fallback: เริ่มผลิตได้เลย — browser รับรู้ผ่าน polling
    enterProductionFresh();
    return;
  }

  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");

  StaticJsonDocument<192> doc;
  doc["shift"]        = String(g_shift);
  doc["employeeId"]   = g_employeeId;  // legacy field
  doc["employee_id"]  = g_employeeId;  // new field (SSE payload)
  doc["confirmed_at"] = (unsigned long)millis(); // epoch ms fallback (server uses NTP)
  String body;
  serializeJson(doc, body);

  // ── 1. Legacy scale-confirm (ให้ web polling ยังทำงานได้) ─────────────
  {
    HTTPClient http;
    http.begin(g_serverUrl + "/api/production-monitor/scale-confirm/" + mid);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);
    int code = http.POST(body);
    Serial.printf("[Scale] scale-confirm POST → %d\n", code);
    http.end();
  }

  // ── 2. New session-confirm (broadcasts SSE to all browsers) ────────────
  {
    HTTPClient http;
    http.begin(g_serverUrl + "/api/production-monitor/session-confirm/" + mid);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);
    int code = http.POST(body);
    Serial.printf("[Scale] session-confirm POST → %d  (shift=%c emp=%s)\n",
      code, g_shift, g_employeeId.c_str());
    http.end();

    if (code >= 200 && code < 300) {
      // Server รับข้อมูลครบ — เริ่มผลิตได้
      enterProductionFresh();
      return;
    }
  }

  // ── Retry on failure ───────────────────────────────────────────────────
  Serial.println("[Scale] Confirm failed — retry in 5s");
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Confirm failed!");
  lcd.setCursor(0, 2); lcd.print("Retrying in 5s...");
  delay(5000);
  sendConfirmToServer();  // recursive retry (max stack ~3 deep before WDT reset)
}

// ======================================================================
//  pollPushToScaleFromServer — StartNow overwrite (P4 Fix)
//
//  Polls GET /api/production-monitor/push-to-scale/{id}
//  → หาก server มี payload ใหม่ (overwrite=true) → บันทึกลง NVS ทันที
//    (ไม่ merge — overwrite ทั้งหมด ป้องกันข้อมูลเก่าค้าง)
//
//  เรียกจาก loop() ทุก POLL_INTERVAL เมื่ออยู่ใน ST_PRODUCTION
// ======================================================================
void pollPushToScaleFromServer() {
  if (!g_wifiOk || g_serverUrl.isEmpty()) return;
  if (g_state != ST_PRODUCTION && g_state != ST_IDLE) return;

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  http.begin(g_serverUrl + "/api/production-monitor/push-to-scale/" + mid);
  http.setTimeout(4000);
  int code = http.GET();

  if (code == 200) {
    StaticJsonDocument<512> doc;
    if (!deserializeJson(doc, http.getString())) {
      bool overwrite = doc["overwrite"] | false;
      if (overwrite) {
        // Overwrite NVS — never merge, always replace on StartNow push
        g_orderId     = doc["order_id"]     | g_orderId.c_str();
        g_productCode = doc["product_name"] | g_productCode.c_str();  // may be product code
        g_targetQty   = doc["qty_target"]   | g_targetQty;
        g_sheetName   = doc["sheet_name"]   | g_sheetName.c_str();
        // qty fields (reset counters for fresh start)
        g_actualCount = doc["qty_good"]     | 0;
        g_qtyGood     = g_actualCount;
        g_qtyRemaining= doc["qty_remaining"] | 0;
        // shift / employee from push (optional — may already be confirmed by keypad)
        String shiftStr = doc["shift"] | "";
        String empStr   = doc["employee_id"] | "";
        if (shiftStr.length() > 0) g_shift      = shiftStr.charAt(0);
        if (empStr.length()   > 0) g_employeeId = empStr;
        // weight fields
        float sw = doc["target_weight"] | 0.0f;
        if (sw > 0) g_stdWeight = sw;

        saveProductionSession();
        if (g_state == ST_IDLE) enterState(ST_PRODUCTION);
        else renderLcd();

        Serial.printf("[Scale] StartNow OVERWRITE: %s qty=%d rem=%d\n",
          g_orderId.c_str(), g_actualCount, g_qtyRemaining);
      }
    }
  }
  http.end();
}

// ======================================================================
//  sendWeightToServer — กด BTN_GREEN/BTN_RED ส่งน้ำหนัก+ประเภทกลับเว็บ
//  POST /api/production-monitor/scale-weight/{MACHINE_ID}
//
//  pressedAt = เวลาที่กดปุ่มจริง (NTP / RTC) — ไม่ใช่เวลาที่ส่งถึง server
//  ถ้า WiFi หลุด: เก็บไว้ใน g_pending แล้ว flush ทีหลัง
// ======================================================================
bool doPostWeight(const String& type, const String& weight, const String& pressedAt) {
  if (!g_wifiOk || g_serverUrl.isEmpty()) return false;

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/scale-weight/" + mid;

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);

  StaticJsonDocument<384> reqDoc;
  reqDoc["orderId"]    = g_orderId;
  reqDoc["sheetName"]  = g_sheetName;
  reqDoc["type"]       = type;
  reqDoc["weight"]     = weight;
  reqDoc["employeeId"] = g_employeeId;
  reqDoc["shift"]      = String(g_shift);
  reqDoc["actualCount"]= g_actualCount;
  reqDoc["pressedAt"]  = pressedAt;
  String body;
  serializeJson(reqDoc, body);

  int code = http.POST(body);
  Serial.printf("[Scale] Weight POST → %d  (%s %s kg) pressedAt=%s\n",
    code, type.c_str(), weight.c_str(), pressedAt.c_str());

  // ── อ่าน response เพื่อรับ qty_remaining + qty_good ──────────────────
  // Response shape: { success, qty_good, qty_remaining, order_id }
  // ถ้า server ส่งมา → แสดงบน LCD บรรทัด 3 ทันที (ไม่ต้องรอ poll)
  if (code == 200 || code == 201) {
    String respBody = http.getString();
    StaticJsonDocument<256> respDoc;
    if (!deserializeJson(respDoc, respBody)) {
      int newGood = respDoc["qty_good"]      | -1;
      int newRem  = respDoc["qty_remaining"] | -1;
      if (newGood >= 0) g_qtyGood      = newGood;
      if (newRem  >= 0) g_qtyRemaining = newRem;
      if (newGood >= 0 || newRem >= 0) {
        // แสดง "ดี X / ค้าง Y" ชั่วคราวบรรทัด 3 (5 วินาที lock เดิมจะล้าง)
        String qtyLine = "G:" + String(g_qtyGood) + " R:" + String(g_qtyRemaining);
        while (qtyLine.length() < 20) qtyLine += ' ';
        lcd.setCursor(0, 3);
        lcd.print(qtyLine.substring(0, 20));
        Serial.printf("[Scale] qty_good=%d qty_remaining=%d\n", g_qtyGood, g_qtyRemaining);
      }
    }
  }

  http.end();
  return (code == 200 || code == 201);
}

void sendWeightToServer(const String& type) {
  String pressedAt = getIsoTime();  // จับเวลา ณ ตอนกดปุ่ม

  if (g_wifiOk && !g_serverUrl.isEmpty()) {
    bool ok = doPostWeight(type, g_liveWeight, pressedAt);
    if (!ok) {
      if (g_pendingCount < MAX_PENDING) {
        g_pending[g_pendingCount++] = { type, g_liveWeight, pressedAt };
        Serial.printf("[Scale] Queued event (total %d)\n", g_pendingCount);
      } else {
        // Queue เต็ม — แจ้ง user บน LCD ชั่วคราว
        Serial.println("[Scale] QUEUE FULL — event dropped!");
        lcd.setCursor(0, 3);
        lcd.print("!QUEUE FULL-CALL IT!");
        delay(3000);
        // คืนบรรทัด 3 เป็น status เดิม(หรือล้าง)
        lcd.setCursor(0, 3);
        lcd.print("                    ");
      }
    }
  } else {
    // WiFi หลุด → queue ไว้ก่อน
    if (g_pendingCount < MAX_PENDING) {
      g_pending[g_pendingCount++] = { type, g_liveWeight, pressedAt };
      Serial.printf("[Scale] WiFi down — queued event (total %d)\n", g_pendingCount);
    } else {
      Serial.println("[Scale] QUEUE FULL — event dropped!");
      lcd.setCursor(0, 3);
      lcd.print("!QUEUE FULL-CALL IT!");
      delay(3000);
      lcd.setCursor(0, 3);
      lcd.print("                    ");
    }
  }
}

// ======================================================================
//  flushPendingEvents — ส่ง event ที่ค้างไว้ทั้งหมดหลัง WiFi กลับมา
// ======================================================================
void flushPendingEvents() {
  if (g_pendingCount == 0 || !g_wifiOk) return;
  Serial.printf("[Scale] Flushing %d pending events...\n", g_pendingCount);
  int sent = 0;
  for (int i = 0; i < g_pendingCount; i++) {
    if (doPostWeight(g_pending[i].type, g_pending[i].weight, g_pending[i].pressedAt)) {
      sent++;
    } else {
      // ส่งไม่ได้ — หยุด flush รอรอบถัดไป (เลื่อน items ที่เหลือไปหน้า)
      int remaining = g_pendingCount - i;
      for (int j = 0; j < remaining; j++) g_pending[j] = g_pending[i + j];
      g_pendingCount = remaining;
      Serial.printf("[Scale] Flush partial: sent %d, %d still queued\n", sent, g_pendingCount);
      return;
    }
    delay(200);  // หน่วงเล็กน้อยไม่ให้ยิง server เร็วเกิน
  }
  g_pendingCount = 0;
  Serial.printf("[Scale] Flush complete: sent %d events\n", sent);
}

// ======================================================================
//  loop
// ======================================================================
void loop() {

  // ─── 1. อ่านข้อมูลตาชั่ง (UART2) ────────────────────────────────
  if (Serial2.available()) {
    String raw = Serial2.readStringUntil('\n');
    raw.trim();
    if (raw.length() > 0) {
      Serial.println("[SCALE] RAW: " + raw);
      // ดึงตัวเลขก้อนสุดท้ายออกมา
      String tmp = ""; bool found = false;
      for (int i = raw.length() - 1; i >= 0; i--) {
        char c = raw.charAt(i);
        if (isDigit(c) || c == '.') { tmp = c + tmp; found = true; }
        else if (c == '-') { tmp = c + tmp; break; }
        else if (found) break;
      }
      if (tmp.length() > 0 && tmp != ".") {
        g_liveWeight = tmp;
        // บรรทัด 1-2 ใน ST_PRODUCTION เป็น static (stdWeight/length/min/max)
        // ไม่ต้อง update in-place — น้ำหนักแสดงเมื่อกดปุ่มบรรทัด 3 เท่านั้น
      }
    }
  }

  // ─── 2. Keypad ────────────────────────────────────────────────────
  char key = keypad.getKey();
  if (key) {
    Serial.println("[KEY] " + String(key));
    handleKeypad(key);
  }

  // ─── 3. BTN_GREEN — ของดี (เฉพาะ PRODUCTION) ────────────────────
  if (g_state == ST_PRODUCTION && digitalRead(BTN_GREEN) == LOW) {
    delay(50);  // debounce
    if (digitalRead(BTN_GREEN) == LOW) {
      while (digitalRead(BTN_GREEN) == LOW);  // รอปล่อยปุ่มก่อนเสมอ
      if (millis() < g_btnLockUntil) {
        // ยังอยู่ในช่วง 5 วินาที — ห้ามส่งซ้ำ
        Serial.println("[BTN] GREEN ignored (locked)");
      } else {
        // รับคำสั่ง: set lock, แสดง status, ส่งข้อมูล
        g_btnLockUntil = millis() + BTN_LOCK_MS;
        g_actualCount++;
        g_lastStatus = "OK - " + trimWeight(g_liveWeight) + " kg.";
        lcd.setCursor(0, 3);
        lcd.print(g_lastStatus);
        sendWeightToServer("good");
        Serial.printf("[BTN] GOOD #%d  w=%s\n", g_actualCount, g_liveWeight.c_str());
        saveProductionSession();
      }
    }
  }

  // ─── 4. BTN_RED — ของเสีย (เฉพาะ PRODUCTION) ────────────────────
  if (g_state == ST_PRODUCTION && digitalRead(BTN_RED) == LOW) {
    delay(50);  // debounce
    if (digitalRead(BTN_RED) == LOW) {
      while (digitalRead(BTN_RED) == LOW);    // รอปล่อยปุ่มก่อนเสมอ
      if (millis() < g_btnLockUntil) {
        // ยังอยู่ในช่วง 5 วินาที — ห้ามส่งซ้ำ
        Serial.println("[BTN] RED ignored (locked)");
      } else {
        g_btnLockUntil = millis() + BTN_LOCK_MS;
        g_lastStatus = "NG - " + trimWeight(g_liveWeight) + " kg.";
        lcd.setCursor(0, 3);
        lcd.print(g_lastStatus);
        sendWeightToServer("ng");    // server accepts "good"/"ng" only
        Serial.printf("[BTN] REJECT  w=%s\n", g_liveWeight.c_str());
        saveProductionSession();   // persist NG count เผื่อไฟดับ
      }
    }
  }

  // ─── 4.5 Auto-clear status line เมื่อ lock หมดอายุ ─────────────
  if (g_state == ST_PRODUCTION && g_btnLockUntil > 0 && millis() >= g_btnLockUntil) {
    g_btnLockUntil = 0;
    g_lastStatus   = "";
    lcd.setCursor(0, 3);
    lcd.print("                    ");  // ล้างบรรทัด 3
  }

  // ─── 4.7 Periodic LCD refresh ทุก 60 วินาที (ST_PRODUCTION เท่านั้น) ──
  // ป้องกัน display controller corrupted / บรรทัด 1-2 แสดง "---" เองอัตโนมัติ
  static unsigned long g_lastLcdRefreshMs = 0;
  if (g_state == ST_PRODUCTION && millis() - g_lastLcdRefreshMs >= 60000UL) {
    g_lastLcdRefreshMs = millis();
    // redraw เฉพาะ บรรทัด 0-2 (ไม่แตะบรรทัด 3 เพราะ status line อาจแสดงอยู่)
    lcd.setCursor(0, 0); lcd.print(g_productCode.substring(0, 20));
    if (g_stdWeight > 0 || g_productLen > 0) {
      String ln1 = "W " + fmtFloat(g_stdWeight) + " kg & L " + String(g_productLen) + " m";
      lcd.setCursor(0, 1); lcd.print((ln1 + "                    ").substring(0, 20));
    } else {
      lcd.setCursor(0, 1); lcd.print("                    ");
    }
    if (g_minWeight > 0 || g_maxWeight > 0) {
      String ln2 = "Min " + fmtFloat(g_minWeight) + " - Max " + fmtFloat(g_maxWeight);
      lcd.setCursor(0, 2); lcd.print((ln2 + "                    ").substring(0, 20));
    } else {
      lcd.setCursor(0, 2); lcd.print("                    ");
    }
  }

  // ─── 5. Poll งานใหม่จาก Server (ทุก POLL_INTERVAL ms) ──────────────
  unsigned long now = millis();
  if (now - g_lastPollMs >= POLL_INTERVAL) {
    g_lastPollMs = now;

    // ── WiFi reconnect with exponential backoff ──────────────────────
    if (WiFi.status() != WL_CONNECTED) {
      bool wasOffline = g_wifiOk;
      g_wifiOk = false;

      // แสดง "WiFi Reconnecting..." บน LCD ทุก state
      if (g_state == ST_IDLE) {
        lcd.setCursor(0, 1); lcd.print("WiFi:Reconnecting.."); // 20 chars
      } else if (g_state == ST_PRODUCTION) {
        // บรรทัด 3 ชั่วคราว (lock timer จะล้างเอง)
        if (millis() >= g_btnLockUntil) {
          lcd.setCursor(0, 3); lcd.print("WiFi:Reconnecting...");
        }
      }

      // ตรวจว่าถึงเวลา retry ตาม backoff หรือยัง
      if (now - g_lastWifiRetryMs >= g_wifiBackoffMs) {
        g_lastWifiRetryMs = now;
        connectWifi();
        if (g_wifiOk) {
          g_wifiBackoffMs = WIFI_BACKOFF_MIN; // reset backoff on success
          if (g_state == ST_IDLE) renderLcd();
          else if (g_state == ST_PRODUCTION) {
            // ล้าง "WiFi Reconnecting..." บรรทัด 3
            lcd.setCursor(0, 3); lcd.print("                    ");
          }
        } else {
          g_wifiBackoffMs = nextWifiBackoff(g_wifiBackoffMs);
          Serial.printf("[WiFi] Retry failed — next attempt in %lums\n", g_wifiBackoffMs);
        }
      }

      // WiFi เพิ่งกลับมา → flush pending events + re-sync
      if (wasOffline && g_wifiOk) {
        flushPendingEvents();
        pollScaleLiveFromServer();
      }

      return; // ออกจาก poll loop รอ WiFi ก่อน
    }

    g_wifiOk = true; // ยืนยันว่า connected

    // WiFi มี pending events → flush ก่อน
    if (g_pendingCount > 0) flushPendingEvents();

    pollScaleLiveFromServer();
    pollJobFromServer();
    pollPushToScaleFromServer(); // P4: StartNow overwrite จาก web
  }
}
