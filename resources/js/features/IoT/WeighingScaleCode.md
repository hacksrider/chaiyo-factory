/* ช่วยแก้ไขไฟล์นี้ถ้ามีสิ่งที่ต้องแก้ไข จะ Copy ไปอัปโหลดลง Code */
/*
  ESP32 Weighing Scale Controller — v2 (WiFi stability fixes)
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
  │ * │ 0 │ # │ D │ ← ผลิต: * เคลียร์แถว4(ตอนล็อก) / Finish; # ยกเลิกงาน
  └───┴───┴───┴───┘

  State Machine (ใช้คำนำหน้า ST_ เพื่อไม่ชนกับ KeyState::IDLE ใน Keypad.h):
  ST_IDLE → รอคำสั่งจากเว็บ (poll ทุก 3 วินาที)
  ST_WAIT_SHIFT → รับงานแล้ว รอกด A/B/C เลือกกะ
  ST_WAIT_EMPLOYEE → รอพิมพ์รหัสพนักงาน (max 14 หลัก) + D ยืนยัน
  ST_CONFIRMING → กำลังส่งยืนยันไป server (รอครู่เดียว)
  ST_PRODUCTION → ผลิต: อ่านน้ำหนัก / กด BTN_GREEN ส่งของดี
  ST_CONFIRM_FINISH → กด * แล้วรอยืนยัน 1=เสร็จสิ้น 2=กลับ
  ST_CONFIRM_CANCEL → กด # แล้วรอยืนยัน 1=ยกเลิก 2=กลับ
  
  User error — ห้ามกดรัวภายใน 5 วินาทีหลังกดติดครั้งหนึ่ง (ส่ง Laravel ครั้งเดียว):
  → ครั้งแรกกด GREEN/RED → ล็อก 5 วิ + โชว์ผลที่บรรทัดที่ 4 (ซอฟแวร์ = setCursor แถว 3)
  → ถ้ากดซ้ำระหว่างล็อก = ถูกบล็อก ไม่ยิง HTTP
  → ปลดล็อกเมื่อครบ 5 วิ (บรรทัด 4 ถูกล้างอัตโนมัติ) — หรือกด * ที่คีย์แพดเพื่อล้างบรรทัด 4 + เปิดให้กด GREEN/RED ใหม่ได้ทันที หากยืนยันว่าอ่านผลแล้ว

  Dependencies (Library Manager):
  - LiquidCrystal I2C (by Frank de Brabander)
  - Keypad             (by Mark Stanley, Alexander Brevig)
  - ArduinoJson        (by Benoit Blanchon)
  - Preferences          (ESP32 NVS — built-in)
  - ElegantOTA

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
#include <WebServer.h>
#include <Keypad.h>
#include <Preferences.h>
#include <time.h>
#include <ElegantOTA.h>

// ป้องกัน brownout reset จากไฟตกชั่วขณะ (เช่น ตอนมอเตอร์เครื่องจักรสตาร์ท)
#include "soc/rtc_cntl_reg.h"
#include "soc/soc.h"

// ======================================================================
//  ⚙️  ปรับค่าตรงนี้ก่อน upload ทุกชุด
// ======================================================================
#define MACHINE_ID  "EM 21"   // รหัสเครื่อง (ต้องตรงกับ Machine ID ในชีต Settings)

// WiFi ที่ใช้งาน (เชื่อมเครือข่ายเดียว KANOK-AP เท่านั้น)
// IT สามารถ Fix IP ได้ผ่าน DHCP Reservation (ผูก MAC → IP ที่ Router)
// บอร์ดใช้ DHCP ปกติ — ถ้า IT ผูก MAC แล้วจะได้ IP คงที่อัตโนมัติ
#define WIFI_SSID   "KANOK-AP"
#define WIFI_PASS   "kanok2564"
#define WIFI_SERVER "https://www.chaiyo-factory.com"
// ======================================================================

// ─── Hardware ──────────────────────────────────────────────────────────
LiquidCrystal_I2C lcd(0x27, 20, 4);
WebServer otaServer(80);

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
  ST_PRODUCTION,
  ST_CONFIRM_FINISH,
  ST_CONFIRM_CANCEL
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

// ─── WiFi reconnect exponential backoff + BSSID lock ───────────────────
// เริ่ม 2 วินาที → สองเท่าทุกรอบ → สูงสุด 60 วินาที (± 20% jitter)
// ป้องกัน ESP32 ping server ถี่เกินช่วง outage ยาว
unsigned long g_wifiBackoffMs        = 2000;
unsigned long g_lastWifiRetryMs      = 0;
unsigned long g_disconnectedSinceMs  = 0;
bool          g_wifiImmediateRecoverTried = false;
const  unsigned long WIFI_BACKOFF_MIN = 2000;
const  unsigned long WIFI_BACKOFF_MAX = 60000;
const  unsigned long WIFI_HARD_RESET_AFTER_MS = 120000;
const  unsigned long WIFI_SCAN_CACHE_MS       = 180000;
static bool     g_hasPreferredBssid   = false;
static uint8_t  g_preferredBssid[6]   = {0};
static int32_t  g_preferredChannel    = 0;
static uint32_t g_lastWifiScanMs      = 0;

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
bool sendWeightToServer(const String& type);
void flushPendingEvents();
void enterState(ScaleState s);
void enterProductionFresh();
void saveProductionSession();
void clearProductionNvs();
bool loadProductionSessionFromNVS();
bool syncWithScaleLive();
void pollScaleLiveFromServer();
String getIsoTime();
void handleScaleStatus(); // หน้าเว็บแสดง IP + MAC Address
void sendFinishToServer();
void sendCancelToServer();
String formatUptimeSec(unsigned long sec);
String rssiQualityLabel(int rssi);
String buildHeartbeatQuery();
bool connectWifi(bool hardReset = true);
bool refreshPreferredAp();
void beginWifiWithBestAp();

// ======================================================================
//  WiFi — scan ล็อก BSSID signal ดีที่สุด + เชื่อม KANOK-AP (DHCP)
// ======================================================================
bool refreshPreferredAp() {
  uint32_t now = millis();
  if (g_hasPreferredBssid && (now - g_lastWifiScanMs) < WIFI_SCAN_CACHE_MS) return true;

  int n = WiFi.scanNetworks(false, true);
  g_lastWifiScanMs = now;
  if (n <= 0) {
    g_hasPreferredBssid = false;
    return false;
  }

  int bestIndex = -1;
  int bestRssi = -127;
  for (int i = 0; i < n; i++) {
    if (WiFi.SSID(i) != WIFI_SSID) continue;
    int rssi = WiFi.RSSI(i);
    if (bestIndex < 0 || rssi > bestRssi) {
      bestIndex = i;
      bestRssi = rssi;
    }
  }

  if (bestIndex < 0) {
    g_hasPreferredBssid = false;
    WiFi.scanDelete();
    return false;
  }

  uint8_t* bssid = WiFi.BSSID(bestIndex);
  if (!bssid) {
    g_hasPreferredBssid = false;
    WiFi.scanDelete();
    return false;
  }

  memcpy(g_preferredBssid, bssid, sizeof(g_preferredBssid));
  g_preferredChannel = WiFi.channel(bestIndex);
  g_hasPreferredBssid = true;

  Serial.printf("[WiFi] Lock AP BSSID=%02X:%02X:%02X:%02X:%02X:%02X ch=%d RSSI=%d\n",
                g_preferredBssid[0], g_preferredBssid[1], g_preferredBssid[2],
                g_preferredBssid[3], g_preferredBssid[4], g_preferredBssid[5],
                (int)g_preferredChannel, bestRssi);
  WiFi.scanDelete();
  return true;
}

void beginWifiWithBestAp() {
  bool hasPreferred = refreshPreferredAp();
  if (hasPreferred && g_preferredChannel > 0) {
    WiFi.begin(WIFI_SSID, WIFI_PASS, g_preferredChannel, g_preferredBssid, true);
    return;
  }
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

bool connectWifi(bool hardReset) {
  WiFi.persistent(false);
  if (hardReset) {
    WiFi.disconnect(true);
    delay(300);
  }
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.setHostname(MACHINE_ID);

  g_serverUrl = WIFI_SERVER;
  Serial.printf("[WiFi] %s connect to \"%s\" ...\n", hardReset ? "Hard" : "Soft", WIFI_SSID);
  Serial.printf("[WiFi] MAC Address: %s\n", WiFi.macAddress().c_str());

  beginWifiWithBestAp();
  Serial.print("[WiFi] Connecting");

  int tries = 0;
  int failedCount = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 60) {
    delay(500);
    Serial.print(".");
    tries++;
    if (WiFi.status() == WL_CONNECT_FAILED) {
      failedCount++;
      if (failedCount >= 5) break;
      WiFi.disconnect(false);
      delay(1000);
      beginWifiWithBestAp();
    }
  }
  Serial.println();

  g_wifiOk = (WiFi.status() == WL_CONNECTED);
  if (g_wifiOk) {
    Serial.printf("[WiFi] ✓ IP: %s  MAC: %s  RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.macAddress().c_str(),
                  WiFi.RSSI());
    Serial.println("[WiFi] Server: " + g_serverUrl);
    configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
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
  return g_wifiOk;
}

// ======================================================================
//  WiFi diagnostics helpers — ใช้บน /status และส่ง heartbeat ไป server
// ======================================================================
String formatUptimeSec(unsigned long sec) {
  unsigned long h = sec / 3600;
  unsigned long m = (sec % 3600) / 60;
  unsigned long s = sec % 60;
  char buf[24];
  snprintf(buf, sizeof(buf), "%lu:%02lu:%02lu", h, m, s);
  return String(buf);
}

String rssiQualityLabel(int rssi) {
  if (rssi >= -60) return "ดีมาก";
  if (rssi >= -75) return "พอใช้";
  return "อ่อน — เสี่ยงหลุด";
}

String buildHeartbeatQuery() {
  if (!g_wifiOk || WiFi.status() != WL_CONNECTED) return "";
  return "?localIp=" + WiFi.localIP().toString()
       + "&rssi=" + String(WiFi.RSSI())
       + "&uptime=" + String(millis() / 1000UL);
}

// ======================================================================
//  handleScaleStatus — หน้าเว็บแสดงข้อมูลบอร์ด: Machine ID, IP, MAC, RSSI
//  เปิดได้ที่ http://<IP>/status
// ======================================================================
void handleScaleStatus() {
  String ip  = g_wifiOk ? WiFi.localIP().toString() : "---";
  String mac = WiFi.macAddress();
  int rssi   = g_wifiOk ? WiFi.RSSI() : 0;
  String up  = formatUptimeSec(millis() / 1000UL);
  String html =
    "<!DOCTYPE html><html><head>"
    "<meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Scale " + String(MACHINE_ID) + "</title>"
    "<style>body{font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px;}"
    "h2{color:#333}table{border-collapse:collapse;width:100%}"
    "td{padding:8px 12px;border:1px solid #ddd}td:first-child{font-weight:bold;background:#f5f5f5}"
    "a{color:#0066cc}hr{margin:20px 0}</style></head><body>"
    "<h2>&#9878;&#65039; Weighing Scale: " + String(MACHINE_ID) + "</h2>"
    "<table>"
    "<tr><td>Machine ID</td><td>" + String(MACHINE_ID) + "</td></tr>"
    "<tr><td>IP Address</td><td>" + ip + "</td></tr>"
    "<tr><td>MAC Address</td><td><b>" + mac + "</b></td></tr>"
    "<tr><td>WiFi</td><td>KANOK-AP</td></tr>"
    "<tr><td>WiFi Status</td><td>" + String(g_wifiOk ? "Connected" : "Disconnected") + "</td></tr>"
    "<tr><td>WiFi RSSI</td><td><b>" + String(rssi) + " dBm</b> (" + rssiQualityLabel(rssi) + ")</td></tr>"
    "<tr><td>Uptime</td><td>" + up + "</td></tr>"
    "</table>"
    "<hr>"
    "<p><a href='/update'>&#128640; OTA Firmware Update</a></p>"
    "</body></html>";
  otaServer.send(200, "text/html", html);
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
  if (g_state != ST_IDLE && g_state != ST_PRODUCTION
      && g_state != ST_CONFIRM_FINISH && g_state != ST_CONFIRM_CANCEL) return false;

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/scale-live/" + mid + buildHeartbeatQuery();
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

  // ── PRODUCTION / ยืนยัน Finish-Cancel + เว็บบอก false → กลับ IDLE ───────
  if ((g_state == ST_PRODUCTION || g_state == ST_CONFIRM_FINISH || g_state == ST_CONFIRM_CANCEL) && !webIsLive) {
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
  // ปิด brownout detector — ป้องกัน reset จากไฟตกชั่วขณะ (มอเตอร์เครื่องจักรสตาร์ท)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  Serial2.begin(2400, SERIAL_8N1, RXD2, TXD2);
  Serial2.setTimeout(20);

  pinMode(BTN_GREEN, INPUT_PULLUP);
  pinMode(BTN_RED,   INPUT_PULLUP);

  lcd.init();
  lcd.backlight();

  // แสดง MAC Address ทันทีตอนเปิดเครื่อง — ให้ IT นำไป fix IP ที่ Router
  WiFi.mode(WIFI_STA);
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
#if defined(ARDUINO_EVENT_WIFI_STA_DISCONNECTED)
    if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
      Serial.printf("[WiFi] Event: STA_DISCONNECTED reason=%d\n", info.wifi_sta_disconnected.reason);
    } else if (event == ARDUINO_EVENT_WIFI_STA_CONNECTED) {
      Serial.println("[WiFi] Event: STA_CONNECTED");
    } else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
      Serial.printf("[WiFi] Event: GOT_IP %s\n", WiFi.localIP().toString().c_str());
    }
#elif defined(SYSTEM_EVENT_STA_DISCONNECTED)
    if (event == SYSTEM_EVENT_STA_DISCONNECTED) {
      Serial.printf("[WiFi] Event: STA_DISCONNECTED reason=%d\n", info.disconnected.reason);
    } else if (event == SYSTEM_EVENT_STA_CONNECTED) {
      Serial.println("[WiFi] Event: STA_CONNECTED");
    } else if (event == SYSTEM_EVENT_STA_GOT_IP) {
      Serial.printf("[WiFi] Event: GOT_IP %s\n", WiFi.localIP().toString().c_str());
    }
#endif
  });
  Serial.printf("[BOOT] Machine ID : %s\n", MACHINE_ID);
  Serial.printf("[BOOT] MAC Address: %s\n", WiFi.macAddress().c_str());

  // ── 1. ลอง restore จาก NVS ก่อน (เร็วสุด — ไม่ต้องรอ WiFi) ──────────────
  bool nvsRestored = loadProductionSessionFromNVS();

  // ── 2. ต่อ WiFi + NTP (retry สูงสุด 10 รอบ) ─────────────────────────────
  if (nvsRestored) {
    renderLcd();
    lcd.setCursor(0, 3); lcd.print("WiFi connecting...  ");
  }
  for (int bootTry = 0; bootTry < 10 && !g_wifiOk; bootTry++) {
    if (bootTry > 0) delay(3000);
    connectWifi();
  }

  // แสดง MAC Address บน LCD บรรทัดที่ 4 ชั่วคราว (~4 วินาที) ก่อนแสดง IP ปกติ
  // เพื่อให้ผู้ดูแลระบบจดบันทึก MAC ได้ (ก่อนที่ IT จะผูก IP ที่ Router)
  {
    String macLine = "M:" + WiFi.macAddress();  // "M:AA:BB:CC:DD:EE:FF" = 19 chars
    while (macLine.length() < 20) macLine += ' ';
    lcd.setCursor(0, 3);
    lcd.print(macLine.substring(0, 20));
    delay(4000);
  }

  // OTA firmware update ผ่านหน้าเว็บ: http://<ESP_IP>/update
  otaServer.on("/status", HTTP_ANY, handleScaleStatus); // หน้าแสดง IP + MAC
  ElegantOTA.begin(&otaServer);
  otaServer.begin();
  Serial.println("[OTA] ready — http://<IP>/update  |  http://<IP>/status");

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
    lcd.setCursor(0, 1); lcd.print(g_wifiOk ? "WiFi: OK!           " : "WiFi: No Network    ");
    lcd.setCursor(0, 2); lcd.print("Waiting command...  ");
    // บรรทัด 4: แสดง IP จริงใน LAN (ใช้ OTA / แก้ปัญหา)
    if (g_wifiOk) {
      String ipLine = "IP:" + WiFi.localIP().toString();
      while (ipLine.length() < 20) ipLine += ' ';
      lcd.setCursor(0, 3); lcd.print(ipLine.substring(0, 20));
    } else {
      lcd.setCursor(0, 3); lcd.print("IP: ---.---.---.--- ");
    }
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

  else if (g_state == ST_CONFIRM_FINISH) {
    lcd.setCursor(0, 0); lcd.print("Sure to Finish?");
    lcd.setCursor(0, 1); lcd.print("1=Yes    2=Back");
    lcd.setCursor(0, 2); lcd.print("                    ");
    lcd.setCursor(0, 3); lcd.print("                    ");
  }

  else if (g_state == ST_CONFIRM_CANCEL) {
    lcd.setCursor(0, 0); lcd.print("Sure to Cancel?");
    lcd.setCursor(0, 1); lcd.print("1=Yes    2=Back");
    lcd.setCursor(0, 2); lcd.print("                    ");
    lcd.setCursor(0, 3); lcd.print("                    ");
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

    // บรรทัดที่ 4 บนจอ (index 3): OK/NG/G:R ระหว่างล็อก 5 วิ — เมื่อว่าง = พร้อมกด GREEN/RED ใหม่ (หรือใช้ * ลบล่วงหน้า)
    lcd.setCursor(0, 3);
    if (g_btnLockUntil > 0 && millis() < g_btnLockUntil && g_lastStatus.length() > 0) {
      String statusLine = g_lastStatus;
      while (statusLine.length() < 20) statusLine += ' ';
      lcd.print(statusLine);
    }
  }
}

// ======================================================================
//  handleKeypad — ประมวลผลปุ่มที่กด
// ======================================================================
void handleKeypad(char key) {
  // ── ยืนยัน Finish / Cancel จากคีย์แพด ─────────────────────────────────
  if (g_state == ST_CONFIRM_FINISH || g_state == ST_CONFIRM_CANCEL) {
    if (key == '1') {
      if (g_state == ST_CONFIRM_FINISH) sendFinishToServer();
      else sendCancelToServer();
    } else if (key == '2') {
      g_state = ST_PRODUCTION;
      renderLcd();
    }
    return;
  }

  // ── PRODUCTION: กด * ระหว่างล็อก 5 วิ = ล้างบรรทัดที่ 4 + ปลดล็อก (เดิม)
  if (g_state == ST_PRODUCTION && key == '*') {
    if (g_btnLockUntil > 0 && millis() < g_btnLockUntil) {
      Serial.println("[KEY] * → clear LCD row 4 + unlock GREEN/RED");
      g_btnLockUntil = 0;
      g_lastStatus   = "";
      lcd.setCursor(0, 3);
      lcd.print("                    ");
      return;
    }
    // ไม่ล็อก → ถามยืนยันเสร็จสิ้นงาน
    Serial.println("[KEY] * → confirm Finish");
    enterState(ST_CONFIRM_FINISH);
    return;
  }

  // ── PRODUCTION: กด # = ถามยืนยันยกเลิกงาน ───────────────────────────
  if (g_state == ST_PRODUCTION && key == '#') {
    if (millis() < g_btnLockUntil) {
      Serial.println("[KEY] # ignored (post-weight lock)");
      return;
    }
    Serial.println("[KEY] # → confirm Cancel");
    enterState(ST_CONFIRM_CANCEL);
    return;
  }

  // ช่วงหลังส่งน้ำหนัก: ห้าม keypad อื่น (ยกเว้น * / # ข้างบน)
  if (g_state == ST_PRODUCTION && millis() < g_btnLockUntil) {
    Serial.println("[KEY] ignored (post-weight lock)");
    return;
  }

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
//  sendFinishToServer — ยืนยัน 1 หลังกด * (เทียบเท่า "เสร็จสิ้นงาน" บนเว็บ)
//  POST /api/production-monitor/scale-finish/{MACHINE_ID}
// ======================================================================
void sendFinishToServer() {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Finishing...");
  lcd.setCursor(0, 1); lcd.print("Please wait...    ");

  if (g_pendingCount > 0 && g_wifiOk) flushPendingEvents();

  if (!g_wifiOk || g_serverUrl.isEmpty()) {
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("WiFi required!");
    lcd.setCursor(0, 2); lcd.print("Press 2 to back   ");
    delay(2500);
    enterState(ST_PRODUCTION);
    return;
  }

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/scale-finish/" + mid + buildHeartbeatQuery();
  http.begin(url);
  http.setTimeout(20000);
  int code = http.POST("");
  Serial.printf("[Scale] scale-finish POST → %d\n", code);
  http.end();

  if (code >= 200 && code < 300) {
    clearProductionNvs();
    g_btnLockUntil = 0;
    g_lastStatus   = "";
    enterState(ST_IDLE);
    Serial.println("[Scale] Finish OK → IDLE");
    return;
  }

  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Finish failed!");
  lcd.setCursor(0, 2); lcd.print("Back to production");
  delay(2500);
  enterState(ST_PRODUCTION);
}

// ======================================================================
//  sendCancelToServer — ยืนยัน 1 หลังกด # (เทียบเท่า "ยกเลิกงาน" บนเว็บ)
//  POST /api/production-monitor/scale-cancel/{MACHINE_ID}
// ======================================================================
void sendCancelToServer() {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Cancelling...");
  lcd.setCursor(0, 1); lcd.print("Please wait...    ");

  if (!g_wifiOk || g_serverUrl.isEmpty()) {
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("WiFi required!");
    lcd.setCursor(0, 2); lcd.print("Press 2 to back   ");
    delay(2500);
    enterState(ST_PRODUCTION);
    return;
  }

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/scale-cancel/" + mid + buildHeartbeatQuery();
  http.begin(url);
  http.setTimeout(15000);
  int code = http.POST("");
  Serial.printf("[Scale] scale-cancel POST → %d\n", code);
  http.end();

  if (code >= 200 && code < 300) {
    clearProductionNvs();
    g_btnLockUntil = 0;
    g_lastStatus   = "";
    enterState(ST_IDLE);
    Serial.println("[Scale] Cancel OK → IDLE");
    return;
  }

  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Cancel failed!");
  lcd.setCursor(0, 2); lcd.print("Back to production");
  delay(2500);
  enterState(ST_PRODUCTION);
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
  String url = g_serverUrl + "/api/production-monitor/scale-command/" + mid + buildHeartbeatQuery();

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
  doc["confirmed_at"] = (unsigned long)millis();
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
  // ใช้ loop แทน recursion — ป้องกัน WDT reset เมื่อ server ไม่ตอบหลายรอบ
  const int MAX_CONFIRM_TRIES = 3;
  for (int attempt = 1; attempt <= MAX_CONFIRM_TRIES; attempt++) {
    HTTPClient http;
    http.begin(g_serverUrl + "/api/production-monitor/session-confirm/" + mid);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);
    int code = http.POST(body);
    Serial.printf("[Scale] session-confirm POST → %d  (shift=%c emp=%s attempt=%d/%d)\n",
      code, g_shift, g_employeeId.c_str(), attempt, MAX_CONFIRM_TRIES);
    http.end();

    if (code >= 200 && code < 300) {
      enterProductionFresh();
      return;
    }

    if (attempt < MAX_CONFIRM_TRIES) {
      Serial.printf("[Scale] Confirm failed — retry %d/%d in 5s\n", attempt, MAX_CONFIRM_TRIES);
      lcd.clear();
      lcd.setCursor(0, 0); lcd.print("Confirm failed!");
      lcd.setCursor(0, 2);
      String msg = "Retry " + String(attempt) + "/" + String(MAX_CONFIRM_TRIES) + " in 5s...";
      lcd.print(msg.substring(0, 20));
      delay(5000);
    }
  }

  // ส่งไม่สำเร็จทุกรอบ — เริ่มผลิต offline และ flush ทีหลัง
  Serial.println("[Scale] Confirm failed all attempts — starting offline");
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("Server unreachable");
  lcd.setCursor(0, 1); lcd.print("Starting offline...");
  delay(2000);
  enterProductionFresh();
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
  // ถ้า server ส่งมา → แสดงบนบรรทัดที่ 4 (ช่องว่างจาก renderLcd) ทันที (ไม่ต้องรอ poll)
  if (code == 200 || code == 201) {
    String respBody = http.getString();
    StaticJsonDocument<256> respDoc;
    if (!deserializeJson(respDoc, respBody)) {
      int srvAc = respDoc["actualCount"] | -1;
      int newGood = respDoc["qty_good"]      | -1;
      int newRem  = respDoc["qty_remaining"] | -1;
      // เลขจาก Laravel (pipe_counter ใน DB) ให้ตรงป้าย/เว็บ — ห้ามนับ g_actualCount เพิ่มเร็วก่อนได้ response
      if (srvAc >= 0) g_actualCount = srvAc;
      else if (newGood >= 0) g_actualCount = newGood;
      if (newGood >= 0) g_qtyGood = newGood;
      else if (srvAc >= 0) g_qtyGood = srvAc;
      if (newRem >= 0) g_qtyRemaining = newRem;
      if (newGood >= 0 || srvAc >= 0 || newRem >= 0) {
        // ชั่วคราวบนบรรทัดที่ 4 — เซ็ต g_lastStatus ให้ตรงกับสิ่งที่วาด (renderLcd ไม่โชว์ "OK-..." เก่าทับ G:R)
        String qtyLine = "G:" + String(g_qtyGood) + " R:" + String(g_qtyRemaining >= 0 ? g_qtyRemaining : 0);
        while (qtyLine.length() < 20) qtyLine += ' ';
        qtyLine = qtyLine.substring(0, 20);
        g_lastStatus = qtyLine;
        lcd.setCursor(0, 3);
        lcd.print(qtyLine);
        Serial.printf("[Scale] qty_good=%d qty_remaining=%d actual=%d\n", g_qtyGood, g_qtyRemaining, g_actualCount);
      }
    }
  }

  http.end();
  return (code == 200 || code == 201);
}

bool sendWeightToServer(const String& type) {
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
    return ok;
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
  return false;
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
  otaServer.handleClient();
  ElegantOTA.loop();

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
        // Lock + แสดงบรรทัด 3 แล้วส่ง HTTP — ครบทั้ง BTN_LOCK_MS ถึงเปิดรับครั้งใหม่; ถ้าโพสต์ล้มเหลวจะเลิก lock
        g_btnLockUntil = millis() + BTN_LOCK_MS;
        // ไม่ ++ g_actualCount ที่นี่ — ให้จาก response (เลขจาก DB เทียบเว็บ/ป้าย)
        g_lastStatus = "OK - " + trimWeight(g_liveWeight) + " kg.";
        lcd.setCursor(0, 3);
        lcd.print(g_lastStatus);
            bool goodOk = sendWeightToServer("good");
        if (!goodOk) {
          g_btnLockUntil = 0;
          // WiFi หลุด แต่ event ถูก queue แล้ว — แจ้ง user
          if (!g_wifiOk) {
            lcd.setCursor(0, 3);
            String qMsg = "!WiFi Lost Q:" + String(g_pendingCount) + "        ";
            lcd.print(qMsg.substring(0, 20));
          }
        }
        Serial.printf("[BTN] GOOD (server count) #%d w=%s\n", g_actualCount, g_liveWeight.c_str());
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
        bool ngOk = sendWeightToServer("ng");
        if (!ngOk) {
          g_btnLockUntil = 0;
          if (!g_wifiOk) {
            lcd.setCursor(0, 3);
            String qMsg = "!WiFi Lost Q:" + String(g_pendingCount) + "        ";
            lcd.print(qMsg.substring(0, 20));
          }
        }
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

    // ── WiFi reconnect: immediate → soft → hard reset ─────────────────
    if (WiFi.status() != WL_CONNECTED) {
      bool wasOffline = g_wifiOk;
      g_wifiOk = false;
      if (g_disconnectedSinceMs == 0) g_disconnectedSinceMs = now;

      if (g_state == ST_IDLE) {
        lcd.setCursor(0, 1); lcd.print("WiFi:Reconnecting..");
        lcd.setCursor(0, 3); lcd.print("IP: ---.---.---.--- ");
      } else if (g_state == ST_PRODUCTION) {
        if (millis() >= g_btnLockUntil) {
          lcd.setCursor(0, 3); lcd.print("!WiFi Lost-queuing..");
        }
      }

      bool recovered = false;

      if (!g_wifiImmediateRecoverTried) {
        g_wifiImmediateRecoverTried = true;
        WiFi.reconnect();
        for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) delay(200);
        recovered = (WiFi.status() == WL_CONNECTED);
      }

      if (!recovered && (now - g_lastWifiRetryMs >= g_wifiBackoffMs)) {
        g_lastWifiRetryMs = now;
        unsigned long disconnectedFor = now - g_disconnectedSinceMs;

        if (disconnectedFor < 60000) {
          WiFi.reconnect();
          for (int i = 0; i < 16 && WiFi.status() != WL_CONNECTED; i++) delay(500);
        }

        if (WiFi.status() != WL_CONNECTED) {
          bool hardReset = (disconnectedFor >= WIFI_HARD_RESET_AFTER_MS);
          recovered = connectWifi(hardReset);
          if (!recovered && !hardReset && disconnectedFor >= 60000) {
            recovered = connectWifi(true);
          }
        } else {
          recovered = true;
        }

        if (recovered) {
          g_wifiOk = true;
          g_wifiBackoffMs = WIFI_BACKOFF_MIN;
          if (g_state == ST_IDLE) {
            renderLcd();
          } else if (g_state == ST_PRODUCTION) {
            lcd.setCursor(0, 3); lcd.print("WiFi OK-Syncing...  ");
          }
        } else {
          g_wifiBackoffMs = nextWifiBackoff(g_wifiBackoffMs);
          Serial.printf("[WiFi] Retry failed — next attempt in %lums\n", g_wifiBackoffMs);
        }
      } else if (WiFi.status() == WL_CONNECTED) {
        recovered = true;
        g_wifiOk = true;
        g_wifiBackoffMs = WIFI_BACKOFF_MIN;
      }

      if (recovered || (wasOffline && g_wifiOk)) {
        g_disconnectedSinceMs = 0;
        g_wifiImmediateRecoverTried = false;
        g_lastWifiRetryMs = 0;
        if (wasOffline && g_wifiOk) {
          flushPendingEvents();
          pollScaleLiveFromServer();
          if (g_state == ST_PRODUCTION && millis() >= g_btnLockUntil) {
            lcd.setCursor(0, 3);
            if (g_pendingCount == 0) {
              lcd.print("WiFi OK-Synced!     ");
              delay(1500);
              lcd.setCursor(0, 3); lcd.print("                    ");
            } else {
              String pendMsg = "!Pending:" + String(g_pendingCount) + "          ";
              lcd.print(pendMsg.substring(0, 20));
            }
          }
        }
      } else {
        return;
      }
    } else {
      if (g_disconnectedSinceMs != 0) {
        g_disconnectedSinceMs = 0;
        g_wifiImmediateRecoverTried = false;
        g_lastWifiRetryMs = 0;
        g_wifiBackoffMs = WIFI_BACKOFF_MIN;
      }
      g_wifiOk = true;
    }

    // ─── Log RSSI ทุก 30 วินาที เพื่อ diagnose signal ──────────────────
    static unsigned long s_lastRssiLogMs = 0;
    if (now - s_lastRssiLogMs >= 30000UL || s_lastRssiLogMs == 0) {
      s_lastRssiLogMs = now;
      int rssi = WiFi.RSSI();
      Serial.printf("[WiFi] RSSI: %d dBm%s\n", rssi,
        rssi < -75 ? " ⚠️ WEAK — อาจหลุด" : (rssi < -60 ? " OK" : " GOOD"));
    }

    // WiFi มี pending events → flush ก่อน
    if (g_pendingCount > 0) flushPendingEvents();

    pollScaleLiveFromServer();
    pollJobFromServer();
    pollPushToScaleFromServer(); // P4: StartNow overwrite จาก web
  }
}
