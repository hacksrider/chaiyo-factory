/*
  โปรแกรมควบคุมป้ายไฟ LED P10 (32x16) จำนวน 4 จอ (128x16)  — v2 (WiFi stability fixes + Temp Web Server)
  - โซน 1 (จอ 1-3): แสดงชื่อสินค้า
  - โซน 2 (จอ 4): แสดงยอดที่ผลิตได้และเป้าหมาย
  - เพิ่มระบบอ่านอุณหภูมิภายในตัวชิป (ESP32 Internal Temperature Sensor)
  - ดูอุณหภูมิผ่านหน้าเว็บโดยพิมพ์: http://<IP_ADDRESS>/temp
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <Adafruit_GFX.h>
#include <U8g2_for_Adafruit_GFX.h>
#include <string.h>
#include <time.h>
#include <ElegantOTA.h>

// ลดโอกาสรีเซ็ตจากไฟตกตอนบูต (HUB75 กินกระแสสูง)
#include "soc/rtc_cntl_reg.h"

// ======================================================================
//  ⚙️ โครงสร้างข้อมูล, ฟังก์ชันอ่าน Sensor และ Prototypes
// ======================================================================
#ifdef __cplusplus
extern "C" {
#endif
uint8_t temprature_sens_read(); // ฟังก์ชันอ่านอุณหภูมิภายในของ ESP32
#ifdef __cplusplus
}
#endif

// โครงสร้างคำสั่งที่รับจาก Laravel Cache
struct LedCmd {
  char    text[256];
  char    actual[16];
  char    target[16];
  uint8_t r, g, b;
  uint8_t fontSize;
  int     speed;
  bool    showClock;
};

// ประกาศฟังก์ชันล่วงหน้าเพื่อให้คอมไพเลอร์รู้จักก่อนเรียกใช้งาน
void updateTextProperties();
void pollTask(void* pv);
bool connectBestWifi();
void processSerialCommand();
void drawAndScrollText();
String buildFingerprintFromLedCmd(const LedCmd& c);
void handleTemp(); // ฟังก์ชันสำหรับส่งค่าอุณหภูมิออกหน้าเว็บ

// ======================================================================
//  ⚙️ ปรับค่าตรงนี้ก่อน upload ทุกชุด
// ======================================================================
#define MACHINE_ID  "EM 06"   // รหัสเครื่อง (ตรงกับ Machine ID ในชีต Settings)

// ── รายการ WiFi ที่รู้จัก ─────────────────────────────────────────────
struct WifiProfile {
  const char* ssid;
  const char* pass;
  const char* serverUrl;
};

const WifiProfile WIFI_PROFILES[] = {
  { "AP-Office", "Info2024",  "https://www.chaiyo-factory.com" },
  { "KANOK-AP",  "kanok2564", "https://www.chaiyo-factory.com" },
};
const int WIFI_PROFILE_COUNT = sizeof(WIFI_PROFILES) / sizeof(WIFI_PROFILES[0]);

// Static IP config ตาม AP
const IPAddress STATIC_GW_AP_OFFICE(192, 168, 3,   1);
const IPAddress STATIC_GW_KANOK_AP (192, 168, 103, 1);
const IPAddress STATIC_SUBNET      (255, 255, 255, 0);
const IPAddress STATIC_DNS1        (8, 8, 8, 8);
const IPAddress STATIC_DNS2        (8, 8, 4, 4);

const char* MACHINE_ID_LIST[] = {
  "EM 01","EM 02","EM 03","EM 04","EM 05","EM 06","EM 07","EM 08",
  "EM 09","EM 10","EM 11","EM 12","EM 13","EM 14","EM 15","EM 16",
  "EM 17","EM 18","EM 19","EM 20","EM 21","EM 22"
};
const int MACHINE_ID_COUNT = sizeof(MACHINE_ID_LIST) / sizeof(MACHINE_ID_LIST[0]);

int getMachineIndex() {
  for (int i = 0; i < MACHINE_ID_COUNT; i++) {
    if (strcmp(MACHINE_ID, MACHINE_ID_LIST[i]) == 0) return i;
  }
  return -1;
}

String g_serverUrl = "";
float g_internalTempC = 0.0f; // ตัวแปร Global สำหรับเก็บค่าอุณหภูมิล่าสุดไว้แสดงบนเว็บ
// ======================================================================

// ---------------- กำหนดขนาดของหน้าจอ ----------------
#define PANEL_RES_X 32
#define PANEL_RES_Y 16
#define PANEL_CHAIN 4
#define NAME_PANELS     3
#define NAME_ZONE_PX    (PANEL_RES_X * NAME_PANELS)
#define NUM_ZONE_X      (PANEL_RES_X * NAME_PANELS)
#define NUM_ZONE_W      PANEL_RES_X
#define PANEL_BRIGHTNESS_NORMAL    40
#define PANEL_BRIGHTNESS_WIFI_BOOT 8

// ---------------- ตัวแปรควบคุมหน้าจอ ----------------
MatrixPanel_I2S_DMA *dma_display = nullptr;
U8G2_FOR_ADAFRUIT_GFX u8g2_for_gfx;
WebServer server(80);

// ---------------- โหมดนาฬิกา ----------------
bool g_clockMode = false;
bool g_ntpSynced = false;
unsigned long g_lastClockTickMs = 0;
unsigned long g_lastNtpAttemptMs = 0;
unsigned long g_lastNtpSuccessMs = 0;

// ---------------- ตัวแปรข้อมูล Production ----------------
String currentText  = "";
String actualCount  = "0";
String targetCount  = "0";
uint16_t currentColor;
int currentFontSize = 1;

// ---------------- ตัวแปรสถานะข้อความโซน 1 ----------------
int textWidth       = 0;
int cursor_x        = 0;
unsigned long lastScrollTime = 0;
int scrollSpeed     = 50;

QueueHandle_t cmdQueue = nullptr; 

static String s_ledStateFingerprint;
static const int         RECONCILE_EVERY_N_POLLS        = 2;
static const uint32_t    WIFI_BACKOFF_MIN_MS            = 2000;
static const uint32_t    WIFI_BACKOFF_MAX_MS            = 60000;
static const uint32_t    WIFI_RECONNECT_INTERVAL_MS     = 5000;
static const uint32_t    NTP_RETRY_GAP_MS               = 10000;
static const uint32_t    NTP_RESYNC_INTERVAL_MS         = 3600000;
static const long        NTP_GMT_OFFSET_SEC             = 7 * 3600;  // Bangkok UTC+7
static bool              g_ntpClockConfigured           = false;

void ensureBangkokClockConfig() {
  if (g_ntpClockConfigured) return;
  configTime(NTP_GMT_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
  g_ntpClockConfigured = true;
  Serial.println("[NTP] Bangkok UTC+7 offset configured");
}

bool jsonWantsClockMode(JsonObject o) {
  if (o.isNull()) return true;
  if (o["showClock"] | false) return true;
  String t = o["text"].as<String>();
  t.trim();
  return t.length() == 0;
}

void syncNtpIfNeeded(bool force = false) {
  if (WiFi.status() != WL_CONNECTED) return;
  unsigned long nowMs = millis();
  if (!force) {
    if (g_ntpSynced && g_lastNtpSuccessMs > 0 && (nowMs - g_lastNtpSuccessMs) < NTP_RESYNC_INTERVAL_MS) return;
    if (g_lastNtpAttemptMs > 0 && (nowMs - g_lastNtpAttemptMs) < NTP_RETRY_GAP_MS) return;
  }
  g_lastNtpAttemptMs = nowMs;

  // ต้องตั้ง offset +7 ก่อนเสมอ — ถ้า getLocalTime สำเร็จก่อนตั้ง TZ จะได้ UTC (ชั่วโมงช้ากว่าไทย 7 ชม.)
  ensureBangkokClockConfig();

  struct tm timeinfo;
  if (!force && g_ntpSynced && getLocalTime(&timeinfo, 0)) {
    g_lastNtpSuccessMs = nowMs;
    return;
  }

  for (int i = 0; i < 25; i++) {
    if (getLocalTime(&timeinfo, 500)) {
      g_ntpSynced = true;
      g_lastNtpSuccessMs = millis();
      Serial.printf("[NTP] Synced Bangkok %02d:%02d:%02d\n",
                    timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
      return;
    }
    vTaskDelay(pdMS_TO_TICKS(200));
  }
  g_ntpSynced = false;
  Serial.println("[NTP] Sync timeout");
}

bool formatClockTime(char* buf, size_t len) {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 50)) {
    strncpy(buf, "-- : -- : --", len);
    buf[len - 1] = '\0';
    return false;
  }
  strftime(buf, len, "%H : %M : %S", &timeinfo);
  return true;
}

void updateClockTextProperties() {
  u8g2_for_gfx.setFont(u8g2_font_helvB08_tf);
  textWidth = u8g2_for_gfx.getUTF8Width(currentText.c_str());
  cursor_x  = max(0, (NAME_ZONE_PX - textWidth) / 2);
}

void applyClockVisual() {
  if (!dma_display) return;
  g_clockMode = true;
  currentFontSize = 1;
  scrollSpeed     = 50;
  currentColor    = dma_display->color565(0, 255, 0);
  actualCount     = "0";
  targetCount     = "0";
  char buf[16];
  formatClockTime(buf, sizeof(buf));
  currentText = String(buf);
  updateClockTextProperties();
  s_ledStateFingerprint = "|CLOCK|0,255,255|1|50|0|0";
  g_lastClockTickMs = millis();
}

void tickClockIfNeeded() {
  if (!g_clockMode) return;
  unsigned long now = millis();
  if (now - g_lastClockTickMs < 1000) return;
  g_lastClockTickMs = now;
  if (!g_ntpSynced) syncNtpIfNeeded();
  char buf[16];
  formatClockTime(buf, sizeof(buf));
  String next = String(buf);
  if (next != currentText) {
    currentText = next;
    updateClockTextProperties();
  }
}

void applyLedCommandFromQueue(const LedCmd& cmd) {
  if (cmd.showClock || cmd.text[0] == '\0') {
    applyClockVisual();
    Serial.println("[LED] Clock mode (HH:MM:SS)");
    return;
  }
  g_clockMode     = false;
  currentText     = String(cmd.text);
  currentFontSize = cmd.fontSize;
  if (cmd.speed > 0) scrollSpeed = max(20, cmd.speed);
  currentColor    = dma_display->color565(cmd.r, cmd.g, cmd.b);
  if (cmd.actual[0] != '\0') actualCount = String(cmd.actual);
  if (cmd.target[0] != '\0') targetCount = String(cmd.target);
  updateTextProperties();
  s_ledStateFingerprint = buildFingerprintFromLedCmd(cmd);
  Serial.println("[LED] Applied: " + currentText + " (" + actualCount + "/" + targetCount + ")");
}

String buildLedStateFingerprint(
  const String& text, int r, int g, int b, int fontSize, int speed, const String& act, const String& tgt) {
  return text + "|" + String(r) + "," + String(g) + "," + String(b)
       + "|" + String(fontSize) + "|" + String(speed)
       + "|" + act + "|" + tgt;
}

String buildFingerprintFromStateJson(JsonObject o) {
  if (o.isNull()) return String();
  if (jsonWantsClockMode(o)) return "|CLOCK|0,255,255|1|50|0|0";
  String t = o["text"].as<String>();
  t.trim();
  int r   = o["r"]         | 0,   g   = o["g"]         | 255, b  = o["b"]         | 255;
  int fs  = o["fontSize"]  | 1,   sp  = o["speed"]    | 50;
  String a = o.containsKey("actual") && !o["actual"].isNull() ? o["actual"].as<String>() : String("0");
  String tg = o.containsKey("target") && !o["target"].isNull() ? o["target"].as<String>() : String("0");
  a.trim();
  if (a.length() == 0) a = "0";
  tg.trim();
  if (tg.length() == 0) tg = "0";
  return buildLedStateFingerprint(t, r, g, b, fs, sp, a, tg);
}

void stateJsonToLedCmd(JsonObject o, LedCmd& cmd) {
  memset(&cmd, 0, sizeof(cmd));
  String t = o["text"].as<String>();
  t.trim();
  cmd.showClock = jsonWantsClockMode(o);
  if (!cmd.showClock) {
    strncpy(cmd.text, t.c_str(), sizeof(cmd.text) - 1);
    cmd.text[sizeof(cmd.text) - 1] = '\0';
  }
  cmd.r  = o["r"]  | 0;   cmd.g  = o["g"]  | 255;  cmd.b  = o["b"]  | 255;
  cmd.fontSize = o["fontSize"] | 1;
  cmd.speed    = o["speed"]    | 0;
  if (o.containsKey("actual") && !o["actual"].isNull()) {
    strncpy(cmd.actual, o["actual"].as<String>().c_str(), sizeof(cmd.actual) - 1);
    cmd.actual[sizeof(cmd.actual) - 1] = '\0';
  }
  if (o.containsKey("target") && !o["target"].isNull()) {
    strncpy(cmd.target, o["target"].as<String>().c_str(), sizeof(cmd.target) - 1);
    cmd.target[sizeof(cmd.target) - 1] = '\0';
  }
}

String buildFingerprintFromLedCmd(const LedCmd& c) {
  String a  = c.actual[0]  ? String(c.actual)  : String("0");
  String tg = c.target[0] ? String(c.target) : String("0");
  a.trim();
  if (a.length()  == 0) a  = "0";
  if (tg.length() == 0) tg = "0";
  return buildLedStateFingerprint(String(c.text), c.r, c.g, c.b, c.fontSize, c.speed, a, tg);
}

void reconcileLedStateWithWeb() {
  if (!cmdQueue || g_serverUrl.isEmpty() || WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/led-status/" + mid;
  http.begin(url);
  http.setTimeout(4000);
  int code = http.GET();
  if (code != 200) {
    Serial.printf("[Reconcile] HTTP %d (ข้าม — รอรอบถัดไป)\n", code);
    http.end();
    return;
  }
  String body = http.getString();
  http.end();

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, body) || !doc["success"].as<bool>()) {
    Serial.println("[Reconcile] parse error — ข้าม");
    return;
  }
  if (!doc["hasState"].as<bool>()) {
    return;
  }
  JsonObject st = doc["state"];
  if (st.isNull()) return;

  String fp = buildFingerprintFromStateJson(st);
  if (fp.length() == 0) return;
  if (s_ledStateFingerprint.length() > 0 && fp == s_ledStateFingerprint) {
    return;
  }

  LedCmd cmd = {};
  stateJsonToLedCmd(st, cmd);
  if (xQueueSend(cmdQueue, &cmd, 0) == pdTRUE) {
    s_ledStateFingerprint = fp;
    Serial.println("[Reconcile] Queued ตรงกับเว็บ: " + String(cmd.text));
  }
}

bool isThaiCombining(uint8_t b2, uint8_t b3) {
  if (b2 == 0xB8 && (b3 == 0xB1 || (b3 >= 0xB4 && b3 <= 0xBA))) return true;
  if (b2 == 0xB9 && (b3 >= 0x87 && b3 <= 0x8E)) return true;
  return false;
}

bool isUpperVowel(uint8_t b2, uint8_t b3) {
  return (b2 == 0xB8 && (b3 == 0xB1 || (b3 >= 0xB4 && b3 <= 0xB7))) || (b2 == 0xB9 && b3 == 0x8D);
}

bool isToneMark(uint8_t b2, uint8_t b3) {
  return b2 == 0xB9 && (b3 >= 0x87 && b3 <= 0x8C);
}

int getThaiTextWidth(String text) {
  int total_width = 0;
  int i = 0;
  while (i < (int)text.length()) {
    String c = "";
    bool isCombining = false;
    uint8_t b1 = (uint8_t)text[i];
    if ((b1 & 0xF0) == 0xE0) {
      if (i + 2 < (int)text.length()) {
        c = text.substring(i, i + 3);
        uint8_t b2 = (uint8_t)text[i + 1];
        uint8_t b3 = (uint8_t)text[i + 2];
        isCombining = isThaiCombining(b2, b3);
      } else {
        c = text.substring(i);
      }
      i += 3;
    } else if ((b1 & 0xE0) == 0xC0) {
      if (i + 1 < (int)text.length()) c = text.substring(i, i + 2);
      else c = text.substring(i);
      i += 2;
    } else if ((b1 & 0x80) == 0x00) {
      c = String((char)b1);
      i += 1;
    } else {
      i++;
      continue;
    }
    if (!isCombining) {
      total_width += u8g2_for_gfx.getUTF8Width(c.c_str());
    }
  }
  return total_width;
}

void printThaiText(String text, int x, int y) {
  int current_x  = x;
  int previous_x = x;
  int i = 0;
  bool has_upper_vowel = false;

  while (i < (int)text.length()) {
    String c = "";
    bool isCombining = false;
    bool isTone  = false;
    bool isUpperV = false;
    uint8_t b1 = (uint8_t)text[i];

    if ((b1 & 0xF0) == 0xE0) {
      if (i + 2 < (int)text.length()) {
        c = text.substring(i, i + 3);
        uint8_t b2 = (uint8_t)text[i + 1];
        uint8_t b3 = (uint8_t)text[i + 2];
        isCombining = isThaiCombining(b2, b3);
        isTone  = isToneMark(b2, b3);
        isUpperV = isUpperVowel(b2, b3);
      } else {
        c = text.substring(i);
      }
      i += 3;
    } else if ((b1 & 0xE0) == 0xC0) {
      if (i + 1 < (int)text.length()) c = text.substring(i, i + 2);
      else c = text.substring(i);
      i += 2;
    } else if ((b1 & 0x80) == 0x00) {
      c = String((char)b1);
      i += 1;
    } else {
      i++;
      continue;
    }

    if (isCombining) {
      if (previous_x < NAME_ZONE_PX && previous_x > -16) {
        int draw_y = y;
        if (isUpperV) has_upper_vowel = true;
        if (isTone && !has_upper_vowel) draw_y = y + 3;
        u8g2_for_gfx.setCursor(previous_x, draw_y);
        u8g2_for_gfx.print(c);
      } else {
        if (isUpperV) has_upper_vowel = true;
      }
    } else {
      has_upper_vowel = false;
      previous_x = current_x;
      int c_width = u8g2_for_gfx.getUTF8Width(c.c_str());
      if (current_x < NAME_ZONE_PX && (current_x + c_width) > -16) {
        u8g2_for_gfx.setCursor(current_x, y);
        u8g2_for_gfx.print(c);
      }
      current_x += c_width;
    }
  }
}

void applyFont(int fs) {
  u8g2_for_gfx.setFont(u8g2_font_etl14thai_t);
}

void updateTextProperties() {
  applyFont(currentFontSize);
  textWidth = getThaiTextWidth(currentText);
  cursor_x  = (textWidth <= NAME_ZONE_PX) ? (NAME_ZONE_PX - textWidth) / 2 : NAME_ZONE_PX;
}

void handleLed() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (server.method() == HTTP_OPTIONS) {
    server.send(200, "text/plain", "");
    return;
  }

  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"ok\":false,\"error\":\"Method Not Allowed\"}");
    return;
  }

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"Invalid JSON\"}");
    return;
  }

  if (doc.containsKey("text"))     currentText     = doc["text"].as<String>();
  if (doc.containsKey("fontSize")) currentFontSize = doc["fontSize"].as<int>();
  if (doc.containsKey("speed"))    scrollSpeed     = max(20, doc["speed"].as<int>());
  if (doc.containsKey("actual"))   actualCount     = doc["actual"].as<String>();
  if (doc.containsKey("target"))   targetCount     = doc["target"].as<String>();
  if (doc.containsKey("r") && doc.containsKey("g") && doc.containsKey("b")) {
    currentColor = dma_display->color565(
      doc["r"].as<int>(), doc["g"].as<int>(), doc["b"].as<int>()
    );
  }
  bool wantClock = doc["showClock"] | false;
  currentText.trim();
  if (wantClock || currentText.length() == 0) {
    applyClockVisual();
  } else {
    g_clockMode = false;
    updateTextProperties();
  }

  String resp = "{\"ok\":true,\"machineId\":\"" + String(MACHINE_ID)
              + "\",\"ip\":\"" + WiFi.localIP().toString() + "\"}";
  server.send(200, "application/json", resp);
}

void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String resp = "{\"ok\":true,\"machineId\":\"" + String(MACHINE_ID)
              + "\",\"ip\":\"" + WiFi.localIP().toString()
              + "\",\"text\":\"" + currentText + "\"}";
  server.send(200, "application/json", resp);
}

void handleMeasure() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");

  if (server.method() == HTTP_OPTIONS) {
    server.send(200, "text/plain", "");
    return;
  }

  String text = server.arg("text");
  applyFont(1); 
  int px = getThaiTextWidth(text);
  String resp = "{\"px\":" + String(px) + ",\"scrolls\":" + (px > NAME_ZONE_PX ? "true" : "false") + "}";
  server.send(200, "application/json", resp);
}

// ─── ➕ ฟังก์ชันหน้าเว็บส่งค่าอุณหภูมิ ───
void handleTemp() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String resp = "{\"ok\":true,\"machineId\":\"" + String(MACHINE_ID)
              + "\",\"ip\":\"" + WiFi.localIP().toString()
              + "\",\"cpu_temperature_c\":" + String(g_internalTempC, 1) + "}";
  server.send(200, "application/json", resp);
}

void applyDefaultLedVisual() {
  applyClockVisual();
}

bool syncLedDisplayFromServer() {
  if (!dma_display || g_serverUrl.isEmpty() || WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/led-status/" + mid;
  Serial.println("[Sync] GET " + url);
  http.begin(url);
  http.setTimeout(5000); 
  int code = http.GET();

  if (code != 200) {
    Serial.printf("[Sync] HTTP %d — fallback default text\n", code);
    applyDefaultLedVisual();
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();
  Serial.println("[Sync] Response: " + body.substring(0, 120)); 

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, body)) {
    Serial.println("[Sync] JSON parse error — fallback default text");
    applyDefaultLedVisual();
    return false;
  }

  if (!doc["success"].as<bool>() || !doc["hasState"].as<bool>()) {
    Serial.println("[Sync] ไม่มี state บนเซิร์ฟเวอร์ — default text");
    applyDefaultLedVisual();
    return false;
  }

  JsonObject st = doc["state"];
  if (st.isNull()) {
    Serial.println("[Sync] state เป็น null — fallback default text");
    applyDefaultLedVisual();
    return false;
  }

  if (jsonWantsClockMode(st)) {
    Serial.println("[Sync] เว็บล้างป้าย / ไม่มีข้อความ — แสดงนาฬิกา");
    applyClockVisual();
    return true;
  }

  g_clockMode     = false;
  String txt = st["text"].as<String>();
  txt.trim();
  currentText     = txt;
  currentFontSize = st["fontSize"] | 1;
  int sp          = st["speed"] | 50;
  scrollSpeed     = max(20, sp);
  int r = st["r"] | 0, g = st["g"] | 255, b = st["b"] | 255;
  currentColor    = dma_display->color565(r, g, b);
  
  if (st.containsKey("actual")) actualCount = st["actual"].as<String>();
  if (st.containsKey("target")) targetCount = st["target"].as<String>();
  updateTextProperties();
  s_ledStateFingerprint = buildFingerprintFromStateJson(st);
  Serial.println("[Sync] ✓ ตรงกับเว็บ: \"" + currentText + "\" (" + actualCount + "/" + targetCount + ")");
  return true;
}

bool connectBestWifi() {
  WiFi.persistent(false);       
  WiFi.disconnect(true);        
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);         
  WiFi.setAutoReconnect(true);  
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  vTaskDelay(pdMS_TO_TICKS(300)); 

  Serial.println("[WiFi] Scanning...");
  int found = WiFi.scanNetworks();
  Serial.printf("[WiFi] พบ %d เครือข่าย\n", found);

  int bestProfileIdx = -1;
  int bestRssi       = -9999;

  for (int s = 0; s < found; s++) {
    String ssid = WiFi.SSID(s);
    int    rssi = WiFi.RSSI(s);
    bool   known = false;
    for (int p = 0; p < WIFI_PROFILE_COUNT; p++) {
      if (ssid == WIFI_PROFILES[p].ssid) {
        known = true;
        if (rssi > bestRssi) { bestRssi = rssi; bestProfileIdx = p; }
      }
    }
    if (known) Serial.printf("  ✓ %-22s  RSSI=%d\n", ssid.c_str(), rssi);
  }
  WiFi.scanDelete(); 
  vTaskDelay(pdMS_TO_TICKS(300)); 

  if (bestProfileIdx < 0) {
    Serial.println("[WiFi] ไม่พบ WiFi ที่รู้จักในรายการ!");
    return false;
  }

  const WifiProfile& net = WIFI_PROFILES[bestProfileIdx];
  Serial.printf("[WiFi] เลือก \"%s\"  RSSI=%d\n", net.ssid, bestRssi);

  int midx = getMachineIndex();
  if (midx >= 0) {
    uint8_t lastOctet = (uint8_t)(101 + midx); 
    bool isKanok = (strcmp(net.ssid, "KANOK-AP") == 0);
    IPAddress staticIp(192, 168, isKanok ? 103 : 3, lastOctet);
    IPAddress gw = isKanok ? STATIC_GW_KANOK_AP : STATIC_GW_AP_OFFICE;
    WiFi.config(staticIp, gw, STATIC_SUBNET, STATIC_DNS1, STATIC_DNS2);
    Serial.printf("[WiFi] Static IP: %s\n", staticIp.toString().c_str());
  }

  if (dma_display) {
    currentText     = "กำลังเชื่อมต่อ..";
    currentFontSize = 1;
    currentColor    = dma_display->color565(255, 140, 0); 
    updateTextProperties();
  }

  WiFi.begin(net.ssid, net.pass);
  Serial.print("[WiFi] Connecting");

  int tries = 0;
  int failedCount = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 60) { 
    vTaskDelay(pdMS_TO_TICKS(500)); 
    Serial.print(".");
    tries++;
    if (WiFi.status() == WL_CONNECT_FAILED) {
      failedCount++;
      if (failedCount >= 5) return false;
      WiFi.disconnect(false);
      vTaskDelay(pdMS_TO_TICKS(1000)); 
      WiFi.begin(net.ssid, net.pass);
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    g_serverUrl = net.serverUrl;
    vTaskDelay(pdMS_TO_TICKS(1500)); 
    syncNtpIfNeeded();
    syncLedDisplayFromServer();
    return true;
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN);
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  dma_display->setBrightness8(PANEL_BRIGHTNESS_WIFI_BOOT);
  dma_display->clearScreen();
  delay(1200); 

  u8g2_for_gfx.begin(*dma_display);
  u8g2_for_gfx.setFontMode(0);
  u8g2_for_gfx.setFontDirection(0);

  currentColor = dma_display->color565(0, 255, 0);
  updateTextProperties();

  bool wifiOk = false;
  for (int bootTry = 0; bootTry < 10 && !wifiOk; bootTry++) {
    if (bootTry > 0) delay(3000); 
    wifiOk = connectBestWifi();
  }
  if (wifiOk) syncNtpIfNeeded(true);

  dma_display->setBrightness8(PANEL_BRIGHTNESS_NORMAL);

  if (!wifiOk) {
    currentText = "WiFi Error";
    updateTextProperties();
  }

  // ลงทะเบียนหน้าเว็บ Endpoint ต่างๆ
  server.on("/led",     HTTP_ANY, handleLed);
  server.on("/status",  HTTP_ANY, handleStatus);
  server.on("/measure", HTTP_ANY, handleMeasure);
  server.on("/temp",    HTTP_ANY, handleTemp); // ─── ➕ เพิ่มลิงก์ดูอุณหภูมิบนเว็บ ───
  
  ElegantOTA.begin(&server);
  server.begin();

  cmdQueue = xQueueCreate(3, sizeof(LedCmd));
  xTaskCreatePinnedToCore(pollTask, "pollTask", 8192, nullptr, 1, nullptr, 0);
  Serial.println("Ready!");
}

void loop() {
  server.handleClient();
  ElegantOTA.loop(); 
  processSerialCommand();
  tickClockIfNeeded();

  LedCmd cmd;
  if (cmdQueue && xQueueReceive(cmdQueue, &cmd, 0) == pdTRUE) {
    applyLedCommandFromQueue(cmd);
  }

  drawAndScrollText();
}

void pollTask(void* pv) {
  const TickType_t pollInterval = pdMS_TO_TICKS(2000);

  static uint32_t lastReconnectMs          = 0;
  static uint32_t wifiBackoffMs            = WIFI_BACKOFF_MIN_MS; 
  static uint32_t disconnectedSince        = 0;
  static bool     showingConnecting        = false;
  static bool     wifiImmediateRecoverTried = false;
  static int      pollCycle                 = 0;

  // ─── ➕ ตัวแปรจับเวลาล็อกอุณหภูมิ ───
  static uint32_t lastTempLogMs            = 0; 

  auto sendConnectingMsg = []() {
    if (!cmdQueue) return;
    LedCmd cmd = {};
    strncpy(cmd.text, "กำลังเชื่อมต่อ..", sizeof(cmd.text) - 1);
    cmd.text[sizeof(cmd.text) - 1] = '\0';
    cmd.r = 255; cmd.g = 140; cmd.b = 0; 
    cmd.fontSize = 1; cmd.speed = 50;
    xQueueSend(cmdQueue, &cmd, 0);
  };

  for (;;) {
    vTaskDelay(pollInterval);

    // ─── ➕ อ่านอุณหภูมิอัปเดตเข้าตัวแปรหลักและล็อก Serial ทุก 30 วินาที ───
    uint32_t currentMs = millis();
    if (currentMs - lastTempLogMs >= 30000 || lastTempLogMs == 0) {
      lastTempLogMs = currentMs;
      g_internalTempC = (temprature_sens_read() - 32) / 1.8f;
      Serial.printf("[TEMP] ESP32 internal: %.1f°C\n", g_internalTempC);
    }

    if (WiFi.status() != WL_CONNECTED) {
      uint32_t now = millis();
      if (disconnectedSince == 0) {
        disconnectedSince = now;
        g_ntpSynced = false;
      }
      if (!showingConnecting) { showingConnecting = true; sendConnectingMsg(); }

      if (!wifiImmediateRecoverTried) {
        wifiImmediateRecoverTried = true;
        WiFi.reconnect();
        for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) vTaskDelay(pdMS_TO_TICKS(200));
        if (WiFi.status() == WL_CONNECTED) continue;
      }

      if (lastReconnectMs == 0 || now - lastReconnectMs >= wifiBackoffMs) {
        lastReconnectMs = now;
        uint32_t disconnectedFor = now - disconnectedSince;
        if (disconnectedFor < 60000) {
          WiFi.reconnect();
          for (int i = 0; i < 16 && WiFi.status() != WL_CONNECTED; i++) vTaskDelay(pdMS_TO_TICKS(500));
        }
        if (WiFi.status() != WL_CONNECTED) connectBestWifi();
        if (WiFi.status() != WL_CONNECTED) {
          uint32_t next = min(wifiBackoffMs * 2, WIFI_BACKOFF_MAX_MS);
          int32_t jitter = (int32_t)(next * 0.2f) * (random(0, 200) - 100) / 100;
          wifiBackoffMs = (uint32_t)max((int32_t)WIFI_BACKOFF_MIN_MS, (int32_t)next + jitter);
        }
      }
      continue;
    }

    bool justReconnected = showingConnecting;
    disconnectedSince = 0; lastReconnectMs = 0; wifiBackoffMs = WIFI_BACKOFF_MIN_MS;
    showingConnecting = false; wifiImmediateRecoverTried = false;

    if (justReconnected) {
      vTaskDelay(pdMS_TO_TICKS(2000));
      syncNtpIfNeeded(true);
      s_ledStateFingerprint = "";
      reconcileLedStateWithWeb();
      vTaskDelay(pdMS_TO_TICKS(1500));
      reconcileLedStateWithWeb();
    }

    if (g_serverUrl.isEmpty()) continue;

    pollCycle++;
    if (pollCycle % RECONCILE_EVERY_N_POLLS == 0) reconcileLedStateWithWeb();

    HTTPClient http;
    String mid = String(MACHINE_ID);
    mid.replace(" ", "%20");
    
    // 💡 ทริกเพิ่มเติม: ส่งค่าอุณหภูมิพ่วงกลับไปที่ Server Dashboard ได้ผ่าน query string ตัวนี้เลยครับ
    String url = g_serverUrl + "/api/production-monitor/led-command/" + mid
               + "?localIp=" + WiFi.localIP().toString()
               + "&temp=" + String(g_internalTempC, 1);
               
    http.begin(url);
    http.setTimeout(1800); 
    int code = http.GET();

    if (code == 200) {
      StaticJsonDocument<512> doc;
      if (!deserializeJson(doc, http.getString()) && doc["pending"].as<bool>()) {
        LedCmd cmd = {};
        cmd.showClock = doc["showClock"] | false;
        String t = doc["text"].as<String>();
        t.trim();
        if (t.length() == 0 || cmd.showClock) {
          cmd.showClock = true;
          cmd.text[0] = '\0';
        } else {
          strncpy(cmd.text, t.c_str(), sizeof(cmd.text) - 1);
          cmd.text[sizeof(cmd.text) - 1] = '\0';
        }
        if (doc.containsKey("actual")) {
          strncpy(cmd.actual, doc["actual"].as<String>().c_str(), sizeof(cmd.actual) - 1);
          cmd.actual[sizeof(cmd.actual) - 1] = '\0';
        }
        if (doc.containsKey("target")) {
          strncpy(cmd.target, doc["target"].as<String>().c_str(), sizeof(cmd.target) - 1);
          cmd.target[sizeof(cmd.target) - 1] = '\0';
        }
        cmd.r        = doc["r"]        | 0;
        cmd.g        = doc["g"]        | 255;
        cmd.b        = doc["b"]        | 255;
        cmd.fontSize = doc["fontSize"] | 1;
        cmd.speed    = doc["speed"]    | 0;
        xQueueSend(cmdQueue, &cmd, 0); 
        s_ledStateFingerprint = buildFingerprintFromStateJson(doc.as<JsonObject>());
      }
    }
    http.end();
  }
}

void processSerialCommand() {
  if (!Serial.available()) return;
  String input = Serial.readStringUntil('\n');
  input.trim();
  if (input.length() == 0) return;

  String parts[6];
  int partCount  = 0;
  int startIndex = 0;
  for (int i = 0; i < (int)input.length(); i++) {
    if (input.charAt(i) == '|') {
      parts[partCount++] = input.substring(startIndex, i);
      startIndex = i + 1;
      if (partCount == 5) break;
    }
  }
  parts[partCount++] = input.substring(startIndex);

  if (parts[0] == "!widths") return;
  if (parts[0].startsWith("!W ")) return;

  if (partCount == 1) {
    currentText = parts[0];
  } else if (partCount >= 3) {
    currentText  = parts[0];
    actualCount  = parts[1];
    targetCount  = parts[2];
    if (partCount == 6) {
      currentColor = dma_display->color565(parts[3].toInt(), parts[4].toInt(), parts[5].toInt());
    }
  }
  updateTextProperties();
}

void drawMachineIdOnLastPanel() {
  const uint8_t* idFonts[] = { u8g2_font_helvB08_tf, u8g2_font_6x10_tf, u8g2_font_5x7_tf, u8g2_font_4x6_tf };
  int idYOffsets[] = { 12, 12, 11, 11 };
  int bestFontIdx = 3;
  int idWidth = 0;

  for (int i = 0; i < 4; i++) {
    u8g2_for_gfx.setFont(idFonts[i]);
    int w = u8g2_for_gfx.getUTF8Width(MACHINE_ID);
    if (w <= NUM_ZONE_W) {
      bestFontIdx = i;
      idWidth = w;
      break;
    }
  }

  if (idWidth == 0) {
    u8g2_for_gfx.setFont(idFonts[bestFontIdx]);
    idWidth = u8g2_for_gfx.getUTF8Width(MACHINE_ID);
  }

  int startX = NUM_ZONE_X + ((NUM_ZONE_W - idWidth) / 2);
  u8g2_for_gfx.setForegroundColor(dma_display->color565(255, 0, 0));
  u8g2_for_gfx.setCursor(startX, idYOffsets[bestFontIdx]);
  u8g2_for_gfx.print(MACHINE_ID);
}

bool shouldShowProductionCounters() {
  if (g_clockMode) return false;
  String act = actualCount;
  String tgt = targetCount;
  act.trim();
  tgt.trim();
  if (act.length() == 0 && tgt.length() == 0) return false;
  return (act.toInt() != 0 || tgt.toInt() != 0);
}

void drawProductionCountersOnLastPanel() {
  const uint8_t* numFonts[] = { u8g2_font_helvB08_tf, u8g2_font_6x10_tf, u8g2_font_5x7_tf, u8g2_font_4x6_tf };
  int numYOffsets[] = { 12, 12, 11, 11 };
  int bestFontIdx = 3;
  int gap = 2;

  for (int i = 0; i < 4; i++) {
    u8g2_for_gfx.setFont(numFonts[i]);
    int w_actual = u8g2_for_gfx.getUTF8Width(actualCount.c_str());
    int w_target = u8g2_for_gfx.getUTF8Width(targetCount.c_str());
    if (w_actual + w_target + gap <= NUM_ZONE_W) {
      bestFontIdx = i;
      break;
    }
  }

  u8g2_for_gfx.setFont(numFonts[bestFontIdx]);
  int draw_y   = numYOffsets[bestFontIdx];
  int w_actual = u8g2_for_gfx.getUTF8Width(actualCount.c_str());
  int w_target = u8g2_for_gfx.getUTF8Width(targetCount.c_str());

  if (NUM_ZONE_W - (w_actual + w_target) >= 6)      gap = 4;
  else if (NUM_ZONE_W - (w_actual + w_target) >= 4) gap = 3;

  int total_block_width = w_actual + gap + w_target;
  int start_x = NUM_ZONE_X + ((NUM_ZONE_W - total_block_width) / 2);
  u8g2_for_gfx.setForegroundColor(dma_display->color565(0, 255, 255));
  u8g2_for_gfx.setCursor(start_x, draw_y);
  u8g2_for_gfx.print(actualCount);

  u8g2_for_gfx.setForegroundColor(dma_display->color565(0, 255, 0));
  u8g2_for_gfx.setCursor(start_x + w_actual + gap, draw_y);
  u8g2_for_gfx.print(targetCount);
}

void drawAndScrollText() {
  if (millis() - lastScrollTime <= (unsigned long)scrollSpeed) return;
  lastScrollTime = millis();
  dma_display->clearScreen();
  dma_display->fillRect(NUM_ZONE_X, 0, NUM_ZONE_W, 16, dma_display->color565(0, 0, 0));

  if (g_clockMode) {
    u8g2_for_gfx.setFont(u8g2_font_helvB08_tf);
    u8g2_for_gfx.setForegroundColor(currentColor);
    u8g2_for_gfx.setCursor(cursor_x, 12);
    u8g2_for_gfx.print(currentText);
    drawMachineIdOnLastPanel();
    return;
  }

  applyFont(currentFontSize);
  u8g2_for_gfx.setForegroundColor(currentColor);
  printThaiText(currentText, cursor_x, 14);

  if (shouldShowProductionCounters()) drawProductionCountersOnLastPanel();
  else drawMachineIdOnLastPanel();

  if (textWidth > NAME_ZONE_PX) {
    cursor_x--;
    if (cursor_x < -textWidth) cursor_x = NAME_ZONE_PX;
  }
}