/* ช่วยแก้ไขไฟล์นี้ถ้ามีสิ่งที่ต้องแก้ไข จะ Copy ไปอัปโหลดลง Code */
/*
  โปรแกรมควบคุมป้ายไฟ LED P10 (32x16) จำนวน 3 จอ (96x16)
  - โซน 1 (จอ 1-2): แสดงชื่อสินค้า (จำกัดการวาดไม่ให้ทะลุจอ 3)
  - โซน 2 (จอ 3): แสดงยอดที่ผลิตได้และเป้าหมาย (ปรับขนาดฟอนต์ และจัดกึ่งกลางแกน X อัตโนมัติ)

  การรับคำสั่ง (Polling + Reconcile อัตโนมัติ):
  - ESP32 poll /led-command ทุก 2 วินาที (คิวคำสั่งใหม่จากเว็บ)
  - นอกจากนี้: GET /led-status ทุก ~4 วิ เปรียบเทียบกับ fingerprint
    → ป้ายจะตรงกับหน้าเว็บ (รวม actual/target) โดยไม่ต้องกดซิงก์
  - หลัง WiFi กลับมา: reconcile ทันที 2 รอบ
  - ไม่ต้องให้ PC รู้ IP ของ ESP32 — ESP32 เป็นฝ่ายเชื่อมต่อออกเอง
  - Serial fallback: text|actual|target|r|g|b

  WiFi (Multi-Network + DHCP อัตโนมัติ):
  - ESP32 จะสแกนสัญญาณ → เลือก SSID ที่รู้จักและ RSSI ดีที่สุดอัตโนมัติ
  - ใช้ DHCP — Router แจก IP เอง ไม่ต้อง hardcode IP ของป้ายในโค้ดหรือชีต
  - ESP32 รายงาน IP จริงของตัวเองมาที่ server ผ่าน polling ทุก 2 วินาที
    → เว็บรู้ IP ปัจจุบันเสมอ ไม่ว่าจะเชื่อม AP ไหน
  - เพิ่ม/แก้รายการ WiFi ได้ใน WIFI_PROFILES ด้านล่าง
  - SERVER_URL ใช้ "http://192.168.3.90:8080" เดียวกันทุก network
  - ตั้งค่า MACHINE_ID ให้ตรงกับ Machine ID ในชีต Settings (ไม่ต้องตั้ง LED_IP แล้ว)

  ถอดปลั๊กแล้วเสียบใหม่แล้ว WiFi ไม่ขึ้น (สาเหตุที่พบบ่อย):
  - แรงดันตก (Brownout): จอ HUB75 กินไฟมากตอนบูต — ถ้า adapter เล็กไป ESP32 รีเซ็ตหรือ WiFi ล้มเหลว
    → ใช้ adapter กระแสเพียงพอ, สายสั้น, หรือลดความสว่างตอนบูต (โค้ดลด brightness ก่อน WiFi แล้วค่อยคืน)
  - Router ยังไม่พร้อม: ลองเชื่อมซ้ำอัตโนมัติ (boot retry + pollTask ช่วงห่าง ไม่สแกนถี่เกิน)

  Dependencies (Library Manager):
  - ESP32-HUB75-MatrixPanel-I2S-DMA
  - Adafruit GFX Library
  - U8g2_for_Adafruit_GFX (by Oli Kraus)
  - ArduinoJson (by Benoit Blanchon)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <Adafruit_GFX.h>
#include <U8g2_for_Adafruit_GFX.h>
#include <string.h>

// ลดโอกาสรีเซ็ตจากไฟตกตอนบูต (HUB75 กินกระแสสูง)
#include "soc/rtc_cntl_reg.h"

// ======================================================================
//  ⚙️  ปรับค่าตรงนี้ก่อน upload ทุกชุด
// ======================================================================
#define MACHINE_ID  "EM 21"   // รหัสเครื่อง (ตรงกับ Machine ID ในชีต Settings)

// ── รายการ WiFi ที่รู้จัก ─────────────────────────────────────────────
// ESP32 จะ scan แล้วเลือก SSID ที่ RSSI ดีที่สุดอัตโนมัติ
// เพิ่ม WiFi ใหม่: คัดลอกบล็อก { ... } แล้วแก้ค่าตามเน็ตเวิร์ก
// serverUrl = URL ของ server หลัก (http://192.168.3.90:8080) — ใช้เดียวกันทุก network
struct WifiProfile {
  const char* ssid;
  const char* pass;
  const char* serverUrl;  // http://192.168.3.90:8080 — server หลัก (เดียวกันทุก network)
};

// ใช้ DHCP — Router แจก IP เอง ไม่ต้อง hardcode
// ESP32 รายงาน IP จริงให้ server ผ่าน heartbeat ทุก 2 วินาที → เว็บรู้ IP เสมอ
// AP-Office และ KANOK-AP route ถึงกันได้ → ใช้ server URL เดียวกันทุก network
const WifiProfile WIFI_PROFILES[] = {
  { "AP-Office", "Info2024",  "http://192.168.3.90:8080" },
  { "KANOK-AP",  "kanok2564", "http://192.168.3.90:8080" },
};
const int WIFI_PROFILE_COUNT = sizeof(WIFI_PROFILES) / sizeof(WIFI_PROFILES[0]);

// g_serverUrl ถูกกำหนดอัตโนมัติใน connectBestWifi() — ห้ามแก้มือที่นี่
String g_serverUrl = "";
// ======================================================================

// ---------------- กำหนดขนาดของหน้าจอ ----------------
#define PANEL_RES_X 32
#define PANEL_RES_Y 16
#define PANEL_CHAIN 3
// ความสว่าง: ตอนบูตลดก่อนเชื่อม WiFi ลดโอกาสแรงดันตก (Brownout) เมื่อถอดปลั๊กแล้วเสียบใหม่
#define PANEL_BRIGHTNESS_NORMAL    40
#define PANEL_BRIGHTNESS_WIFI_BOOT 8

// ---------------- ตัวแปรควบคุมหน้าจอ ----------------
MatrixPanel_I2S_DMA *dma_display = nullptr;
U8G2_FOR_ADAFRUIT_GFX u8g2_for_gfx;
WebServer server(80);

// ---------------- ข้อความเริ่มต้นเมื่อเว็บไม่มี state / ข้อความว่าง ----------------
#define DEFAULT_LED_TEXT "ป้ายไฟพร้อม!"

// ---------------- ตัวแปรข้อมูล Production ----------------
String currentText  = DEFAULT_LED_TEXT;
String actualCount  = "0";
String targetCount  = "0";
uint16_t currentColor;
int currentFontSize = 1; // 0=เล็ก(10px), 1=กลาง(14px), 2=ใหญ่(16px)

// ---------------- ตัวแปรสถานะข้อความโซน 1 ----------------
int textWidth       = 0;
int cursor_x        = 0;
unsigned long lastScrollTime = 0;
int scrollSpeed     = 50;

// ──────────────────────────────────────────────────────────────────────
//  FreeRTOS — แยก polling ออกจาก display loop
//  pollTask วิ่งบน Core 0 / display + server วิ่งบน Core 1 (default Arduino core)
// ──────────────────────────────────────────────────────────────────────

// โครงสร้างคำสั่งที่รับจาก Laravel Cache
struct LedCmd {
  char    text[256];
  char    actual[16];  // actualCount (ของดีที่ผลิตแล้ว)
  char    target[16];  // targetCount (เป้า/กะ)
  uint8_t r, g, b;
  uint8_t fontSize;
  int     speed;   // 0 = ไม่เปลี่ยน
};

QueueHandle_t cmdQueue = nullptr; // Queue ส่งคำสั่งจาก pollTask → loop()

static String s_ledStateFingerprint;
static const int         RECONCILE_EVERY_N_POLLS        = 2;
// WiFi reconnect exponential backoff — เริ่ม 2s → สูงสุด 60s (± 20% jitter)
static const uint32_t    WIFI_BACKOFF_MIN_MS            = 2000;
static const uint32_t    WIFI_BACKOFF_MAX_MS            = 60000;
static const uint32_t    WIFI_RECONNECT_INTERVAL_MS     = 5000; // legacy — replaced by backoff below

String buildLedStateFingerprint(
  const String& text, int r, int g, int b, int fontSize, int speed, const String& act, const String& tgt) {
  return text + "|" + String(r) + "," + String(g) + "," + String(b)
       + "|" + String(fontSize) + "|" + String(speed)
       + "|" + act + "|" + tgt;
}

String buildFingerprintFromStateJson(JsonObject o) {
  if (o.isNull()) return String();
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
  if (t.length() == 0) {
    strncpy(cmd.text, DEFAULT_LED_TEXT, sizeof(cmd.text) - 1);
  } else {
    strncpy(cmd.text, t.c_str(), sizeof(cmd.text) - 1);
  }
  cmd.text[sizeof(cmd.text) - 1] = '\0';
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
  String txt = st["text"].as<String>();
  txt.trim();
  if (txt.length() == 0) return;

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

// ======================================================================
//  ฟังก์ชันเสริมสำหรับจัดการสระภาษาไทย
// ======================================================================
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
      if (previous_x < 64 && previous_x > -16) {
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
      if (current_x < 64 && (current_x + c_width) > -16) {
        u8g2_for_gfx.setCursor(current_x, y);
        u8g2_for_gfx.print(c);
      }
      current_x += c_width;
    }
  }
}

// ======================================================================
//  เลือกฟอนต์ตาม fontSize (0=เล็ก, 1=กลาง, 2=ใหญ่)
//  - fontSize 0 และ 1 ใช้ฟอนต์ไทย etl14thai (ขนาด 14px)
//  - fontSize 2 ลอง etl16thai ถ้าไม่มีให้ fallback กลับ etl14thai
// ======================================================================
void applyFont(int fs) {
  if (fs == 0) {
    // เล็ก — ใช้ฟอนต์ไทย 10px ถ้ามี ไม่งั้น fallback 14px
    // u8g2_for_gfx.setFont(u8g2_font_etl10thai_t); // ปลดคอมเมนต์ถ้า compile ผ่าน
    u8g2_for_gfx.setFont(u8g2_font_etl14thai_t);
  } else if (fs == 1) {
    u8g2_for_gfx.setFont(u8g2_font_etl14thai_t);
  } else {
    // ใหญ่ — ลอง 16px
    // u8g2_for_gfx.setFont(u8g2_font_etl16thai_t); // ปลดคอมเมนต์ถ้า compile ผ่าน
    u8g2_for_gfx.setFont(u8g2_font_etl14thai_t);
  }
}

void updateTextProperties() {
  applyFont(currentFontSize);
  textWidth = getThaiTextWidth(currentText);
  cursor_x  = (textWidth <= 64) ? (64 - textWidth) / 2 : 64;
}

// ======================================================================
//  HTTP Handler: POST /led
//  Body (JSON): { "text":"...", "r":0, "g":255, "b":255,
//                 "fontSize":1, "speed":50 }
//  Response: { "ok": true, "ip": "...", "machineId": "..." }
// ======================================================================
void handleLed() {
  // CORS — ต้องส่งทุก response รวมถึง OPTIONS preflight
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  // Browser ส่ง OPTIONS ก่อนทุก cross-origin POST — ต้องตอบ 200 (บางเบราว์เซอร์ไม่รับ 204)
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

  updateTextProperties();

  String resp = "{\"ok\":true,\"machineId\":\"" + String(MACHINE_ID)
              + "\",\"ip\":\"" + WiFi.localIP().toString() + "\"}";
  server.send(200, "application/json", resp);
}

// GET /status — ใช้ตรวจสอบว่าออนไลน์อยู่
void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String resp = "{\"ok\":true,\"machineId\":\"" + String(MACHINE_ID)
              + "\",\"ip\":\"" + WiFi.localIP().toString()
              + "\",\"text\":\"" + currentText + "\"}";
  server.send(200, "application/json", resp);
}

// GET /measure?text=... — วัดความกว้าง LED pixel จริงจากฟอนต์ etl14thai
// เว็บ preview ใช้เพื่อตรวจว่าข้อความจะวิ่งหรือไม่ (แทนการ hardcode ค่าประมาณ)
void handleMeasure() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");

  if (server.method() == HTTP_OPTIONS) {
    server.send(200, "text/plain", "");
    return;
  }

  String text = server.arg("text");
  applyFont(1); // etl14thai — ฟอนต์เดียวกับที่แสดงบนป้าย
  int px = getThaiTextWidth(text);
  String resp = "{\"px\":" + String(px) + ",\"scrolls\":" + (px > 64 ? "true" : "false") + "}";
  server.send(200, "application/json", resp);
}

// ======================================================================
//  applyDefaultLedVisual — ข้อความ/สีเริ่มต้นเมื่อเว็บไม่มีอะไรให้แสดง
// ======================================================================
void applyDefaultLedVisual() {
  if (!dma_display) return;
  currentText     = DEFAULT_LED_TEXT;
  currentFontSize = 1;
  scrollSpeed     = 50;
  currentColor    = dma_display->color565(0, 255, 255);
  actualCount     = "0";
  targetCount     = "0";
  updateTextProperties();
  s_ledStateFingerprint = buildLedStateFingerprint(
    String(DEFAULT_LED_TEXT), 0, 255, 255, 1, 50, "0", "0");
}

// ======================================================================
//  syncLedDisplayFromServer — ดึง led_state จาก Laravel ให้ตรงกับหน้าเว็บ
//  เรียกหลัง WiFi เชื่อมสำเร็จ (บูต / reconnect)
// ======================================================================
// คืน true ถ้า sync สำเร็จ (มี state จากเว็บ), false ถ้า fallback
bool syncLedDisplayFromServer() {
  if (!dma_display || g_serverUrl.isEmpty() || WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/led-status/" + mid;
  Serial.println("[Sync] GET " + url);
  http.begin(url);
  http.setTimeout(5000); // เพิ่มเป็น 5s กันกรณี server ช้า
  int code = http.GET();

  if (code != 200) {
    Serial.printf("[Sync] HTTP %d — fallback default text\n", code);
    applyDefaultLedVisual();
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();
  Serial.println("[Sync] Response: " + body.substring(0, 120)); // log 120 ตัวแรก

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, body)) {
    Serial.println("[Sync] JSON parse error — fallback default text");
    applyDefaultLedVisual();
    return false;
  }

  if (!doc["success"].as<bool>() || !doc["hasState"].as<bool>()) {
    Serial.println("[Sync] ไม่มี state บนเซิร์ฟเวอร์ (hasState=false) — default text");
    applyDefaultLedVisual();
    return false;
  }

  JsonObject st = doc["state"];
  if (st.isNull()) {
    Serial.println("[Sync] state เป็น null — fallback default text");
    applyDefaultLedVisual();
    return false;
  }

  String txt = st["text"].as<String>();
  txt.trim();
  if (txt.length() == 0) {
    Serial.println("[Sync] ข้อความว่างบนเว็บ — default text");
    applyDefaultLedVisual();
    return false;
  }

  currentText     = txt;
  currentFontSize = st["fontSize"] | 1;
  int sp          = st["speed"] | 50;
  scrollSpeed     = max(20, sp);
  int r = st["r"] | 0, g = st["g"] | 255, b = st["b"] | 255;
  currentColor    = dma_display->color565(r, g, b);
  // กู้คืน actual/target เมื่อ reconnect WiFi
  if (st.containsKey("actual")) actualCount = st["actual"].as<String>();
  if (st.containsKey("target")) targetCount = st["target"].as<String>();
  updateTextProperties();
  s_ledStateFingerprint = buildFingerprintFromStateJson(st);
  Serial.println("[Sync] ✓ ตรงกับเว็บ: \"" + currentText + "\" (" + actualCount + "/" + targetCount + ")");
  return true;
}

// ======================================================================
//  connectBestWifi — สแกนแล้วเลือก WiFi ที่ RSSI ดีที่สุดจากรายการ
//  คืนค่า true เมื่อเชื่อมต่อสำเร็จ และตั้งค่า g_serverUrl ให้อัตโนมัติ
// ======================================================================
bool connectBestWifi() {
  WiFi.persistent(false);   // ป้องกัน credentials เก่าใน flash รบกวน
  WiFi.disconnect(true);    // ตัด connection เดิมและล้าง state
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  delay(300);               // รอ mode switch เสร็จสมบูรณ์

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
    // แสดงเฉพาะตัวที่รู้จักในรายการ (✓) เพื่อไม่ให้ Serial รก
    if (known) Serial.printf("  ✓ %-22s  RSSI=%d\n", ssid.c_str(), rssi);
  }
  WiFi.scanDelete(); // คืน memory
  delay(300);        // ← สำคัญ: รอ radio ออกจาก scan mode ก่อน connect

  if (bestProfileIdx < 0) {
    Serial.println("[WiFi] ไม่พบ WiFi ที่รู้จักในรายการ!");
    return false;
  }

  const WifiProfile& net = WIFI_PROFILES[bestProfileIdx];
  Serial.printf("[WiFi] เลือก \"%s\"  RSSI=%d\n", net.ssid, bestRssi);

  // แสดงบนป้ายว่ากำลังเชื่อมต่อ
  if (dma_display) {
    currentText     = "กำลังเชื่อมต่อ..";
    currentFontSize = 1;
    currentColor    = dma_display->color565(255, 140, 0); // สีส้ม
    updateTextProperties();
  }

  WiFi.begin(net.ssid, net.pass); // DHCP — Router แจก IP เอง
  Serial.print("[WiFi] Connecting");

  int tries = 0;
  int failedCount = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 60) { // 60×500ms = 30 วินาที
    delay(500);
    Serial.print(".");
    tries++;
    // WL_CONNECT_FAILED (4) อาจเกิดจาก RF interference ของ HUB75 DMA หรือ AP ยุ่ง
    // → ไม่หยุดทันที แต่ถ้าเกิดซ้ำ 5 ครั้งติดกันค่อยถือว่ารหัสผ่านผิดจริง
    if (WiFi.status() == WL_CONNECT_FAILED) {
      failedCount++;
      Serial.printf("\n[WiFi] status=4 (ครั้งที่ %d) — retry...\n", failedCount);
      if (failedCount >= 5) {
        Serial.printf("[WiFi] ✗ AP ปฏิเสธซ้ำ 5 ครั้ง  ssid=\"%s\"  pass=\"%s\"\n",
                      net.ssid, net.pass);
        if (dma_display) {
          currentText  = "WiFi Error";
          currentColor = dma_display->color565(255, 0, 0);
          updateTextProperties();
        }
        return false;
      }
      // รีเซ็ต connection แล้วลองใหม่
      WiFi.disconnect(false);
      delay(1000);
      WiFi.begin(net.ssid, net.pass);
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    g_serverUrl = net.serverUrl;
    Serial.printf("\n[WiFi] OK! IP=%s  →  %s\n",
                  WiFi.localIP().toString().c_str(), g_serverUrl.c_str());
    // รอ 1.5s ให้ routing/DHCP ของ router พร้อมก่อน — ถ้าเรียก HTTP ทันทีมักจะ timeout
    delay(1500);
    // ดึง led_state จาก Laravel ให้ป้ายตรงกับหน้าเว็บ
    // ถ้ายังล้มเหลว pollTask จะ retry ซ้ำในรอบถัดไป
    syncLedDisplayFromServer();
    return true;
  }

  // status codes: 1=NO_SSID, 4=CONNECT_FAILED(รหัสผิด), 6=DISCONNECTED(timeout)
  Serial.printf("\n[WiFi] เชื่อมต่อไม่สำเร็จ  status=%d\n", WiFi.status());
  if (dma_display) {
    currentText  = "WiFi Error";
    currentColor = dma_display->color565(255, 0, 0); // สีแดง
    updateTextProperties();
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  Serial.println("Starting LED Matrix Panel...");
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN);
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  // ลดความสว่างก่อน WiFi — จอ HUB75 กินไฟมาก ถ้าเต็มทันทีแรงดันอาจตกจน ESP32/WiFi ล้มเหลวหลังเสียบปลั๊ก
  dma_display->setBrightness8(PANEL_BRIGHTNESS_WIFI_BOOT);
  dma_display->clearScreen();
  delay(1200); // ให้ PSU นิ่งก่อน (ชุด PSU/ชิลด์บางตัวต้องรอมากขึ้น)

  u8g2_for_gfx.begin(*dma_display);
  u8g2_for_gfx.setFontMode(0);
  u8g2_for_gfx.setFontDirection(0);

  currentColor = dma_display->color565(0, 255, 255);
  updateTextProperties();

  // ---------- WiFi (auto-select best signal) — ลองหลายรอบตอนบูต ----------
  bool wifiOk = false;
  for (int bootTry = 0; bootTry < 10 && !wifiOk; bootTry++) {
    if (bootTry > 0) {
      Serial.printf("[WiFi] Boot retry %d/10...\n", bootTry + 1);
      delay(3000); // รอ 3s ให้ RF settle ก่อน retry (HUB75 DMA อาจรบกวน 2.4GHz)
    }
    wifiOk = connectBestWifi();
  }

  dma_display->setBrightness8(PANEL_BRIGHTNESS_NORMAL);

  // wifiOk: ข้อความบนป้ายถูกตั้งแล้วใน syncLedDisplayFromServer() ภายใน connectBestWifi()
  if (!wifiOk) {
    currentText = "WiFi Error";
    updateTextProperties();
  }

  // ---------- HTTP server ----------
  server.on("/led",     HTTP_ANY, handleLed);
  server.on("/status",  HTTP_ANY, handleStatus);
  server.on("/measure", HTTP_ANY, handleMeasure);
  server.begin();
  Serial.println("HTTP server started on port 80");

  // ---------- FreeRTOS polling task ----------
  // สร้าง queue รับคำสั่งจาก pollTask (จุ 3 คำสั่ง)
  cmdQueue = xQueueCreate(3, sizeof(LedCmd));

  // รัน pollTask บน Core 0, stack 8KB, priority 1
  // Core 1 (default Arduino core) ทำ display + HTTP server
  xTaskCreatePinnedToCore(pollTask, "pollTask", 8192, nullptr, 1, nullptr, 0);

  Serial.println("Poll task started (Core 0, every 2s)");
  Serial.println("SERVER_URL: " + g_serverUrl);
  Serial.println("MACHINE_ID: " + String(MACHINE_ID));
  Serial.println("IP: " + WiFi.localIP().toString() + " (DHCP — รายงานให้ server อัตโนมัติ)");
  Serial.println("Ready!");
}

// ======================================================================
//  loop  (Core 1 — display + HTTP server)
//  ไม่มี blocking call ที่นี่เลย → scroll ลื่น 50ms ทุกครั้ง
// ======================================================================
void loop() {
  server.handleClient();   // HTTP server (status / direct push fallback)
  processSerialCommand();  // fallback Serial

  // รับคำสั่งที่ pollTask ส่งมาผ่าน Queue (non-blocking, pdMS_TO_TICKS(0))
  LedCmd cmd;
  if (cmdQueue && xQueueReceive(cmdQueue, &cmd, 0) == pdTRUE) {
    currentText     = String(cmd.text);
    currentFontSize = cmd.fontSize;
    if (cmd.speed > 0) scrollSpeed = max(20, cmd.speed);
    currentColor    = dma_display->color565(cmd.r, cmd.g, cmd.b);
    // อัปเดต actual/target ถ้ามีใน command
    if (cmd.actual[0] != '\0') actualCount = String(cmd.actual);
    if (cmd.target[0] != '\0') targetCount = String(cmd.target);
    updateTextProperties();
    s_ledStateFingerprint = buildFingerprintFromLedCmd(cmd);
    Serial.println("[LED] Applied: " + currentText + " (" + actualCount + "/" + targetCount + ")");
  }

  drawAndScrollText();
}

// ======================================================================
//  pollTask — วิ่งบน Core 0 เป็น background task
//  ดึงคำสั่งจาก Laravel Cache ทุก 2 วินาที
//  ไม่ block loop() เลย เพราะรันบน task แยก
//
//  กลยุทธ์ WiFi reconnect:
//  ① ทันทีที่หลุด → แสดง "กำลังเชื่อมต่อ.." บนป้าย (ผ่าน queue)
//  ② หลุดแล้วลอง WiFi.reconnect() ทันที (ครั้งแรกของรอบหลุด) แล้วทุก ~5s สลับกับ full scan
//  ③ ถ้า reconnect ล้มเหลว หรือหลุดนานเกิน 60s → connectBestWifi() (full scan)
//  ④ วนซ้ำตลอดไป ไม่มีเงื่อนไขหยุด
// ======================================================================
void pollTask(void* pv) {
  const TickType_t pollInterval = pdMS_TO_TICKS(2000);

  static uint32_t lastReconnectMs          = 0;
  static uint32_t wifiBackoffMs            = WIFI_BACKOFF_MIN_MS; // current backoff delay
  static uint32_t disconnectedSince        = 0;
  static bool     showingConnecting        = false;
  static bool     wifiImmediateRecoverTried = false;
  static int      pollCycle                 = 0;

  // ส่ง cmd "กำลังเชื่อมต่อ.." ผ่าน queue (thread-safe — ไม่แก้ global โดยตรง)
  auto sendConnectingMsg = []() {
    if (!cmdQueue) return;
    LedCmd cmd = {};
    strncpy(cmd.text, "กำลังเชื่อมต่อ..", sizeof(cmd.text) - 1);
    cmd.text[sizeof(cmd.text) - 1] = '\0';
    cmd.r = 255; cmd.g = 140; cmd.b = 0; // สีส้ม
    cmd.fontSize = 1; cmd.speed = 50;
    xQueueSend(cmdQueue, &cmd, 0);
  };

  for (;;) {
    vTaskDelay(pollInterval);

    // ───── WiFi ไม่ได้เชื่อมอยู่ → พยายามเชื่อมตลอด ─────
    if (WiFi.status() != WL_CONNECTED) {
      uint32_t now = millis();

      // บันทึกเวลาที่เริ่มหลุดครั้งแรก
      if (disconnectedSince == 0) disconnectedSince = now;

      // แสดง "กำลังเชื่อมต่อ.." บนป้ายครั้งเดียว (ไม่ spam queue)
      if (!showingConnecting) {
        showingConnecting = true;
        sendConnectingMsg();
      }

      if (!wifiImmediateRecoverTried) {
        wifiImmediateRecoverTried = true;
        Serial.println("[Poll] WiFi หลุด — ลอง reconnect ทันที");
        WiFi.reconnect();
        for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) {
          vTaskDelay(pdMS_TO_TICKS(200));
        }
        if (WiFi.status() == WL_CONNECTED) {
          continue;
        }
      }

      // ── Exponential backoff reconnect ──────────────────────────────
      // รอตาม wifiBackoffMs (± 20% jitter) ก่อนลอง reconnect แต่ละครั้ง
      if (lastReconnectMs == 0 || now - lastReconnectMs >= wifiBackoffMs) {
        lastReconnectMs = now;
        uint32_t disconnectedFor = now - disconnectedSince;

        if (disconnectedFor < 60000) {
          Serial.printf("[Poll] WiFi หลุด %lus — Quick reconnect (backoff=%lums)...\n",
            disconnectedFor / 1000, wifiBackoffMs);
          WiFi.reconnect();
          for (int i = 0; i < 16 && WiFi.status() != WL_CONNECTED; i++) {
            vTaskDelay(pdMS_TO_TICKS(500));
          }
        }

        if (WiFi.status() != WL_CONNECTED) {
          Serial.println("[Poll] Quick reconnect ไม่สำเร็จ — Full scan...");
          connectBestWifi();
        }

        if (WiFi.status() != WL_CONNECTED) {
          // คำนวณ backoff ถัดไป: double + ±20% jitter, cap at WIFI_BACKOFF_MAX_MS
          uint32_t next = min(wifiBackoffMs * 2, WIFI_BACKOFF_MAX_MS);
          int32_t jitter = (int32_t)(next * 0.2f) * (random(0, 200) - 100) / 100;
          wifiBackoffMs = (uint32_t)max((int32_t)WIFI_BACKOFF_MIN_MS, (int32_t)next + jitter);
          Serial.printf("[Poll] WiFi ยังไม่เชื่อม — next retry in %lums\n", wifiBackoffMs);
        }
      }
      continue;
    }

    // ───── เชื่อมอยู่ → รีเซ็ต state ─────
    bool justReconnected = showingConnecting;
    disconnectedSince = 0;
    lastReconnectMs   = 0;
    wifiBackoffMs     = WIFI_BACKOFF_MIN_MS; // reset backoff on success
    showingConnecting = false;
    wifiImmediateRecoverTried = false;

    if (justReconnected) {
      vTaskDelay(pdMS_TO_TICKS(2000));
      Serial.println("[Poll] WiFi เชื่อมสำเร็จ — Reconcile กับเว็บ...");
      s_ledStateFingerprint = "";
      reconcileLedStateWithWeb();
      vTaskDelay(pdMS_TO_TICKS(1500));
      reconcileLedStateWithWeb();
    }

    if (g_serverUrl.isEmpty()) continue;

    pollCycle++;
    if (pollCycle % RECONCILE_EVERY_N_POLLS == 0) {
      reconcileLedStateWithWeb();
    }

    HTTPClient http;
    // URL-encode MACHINE_ID (ช่องว่างต้องเป็น %20 ไม่งั้น HTTP request จะ malformed)
    String mid = String(MACHINE_ID);
    mid.replace(" ", "%20");
    String url = g_serverUrl + "/api/production-monitor/led-command/" + mid;
    http.begin(url);
    http.setTimeout(1800); // timeout ของ HTTP request (ไม่ block loop() เพราะอยู่ task แยก)

    int code = http.GET();

    if (code == 200) {
      StaticJsonDocument<512> doc;
      if (!deserializeJson(doc, http.getString()) && doc["pending"].as<bool>()) {
        LedCmd cmd = {};
        String t = doc["text"].as<String>();
        t.trim();
        if (t.length() == 0) {
          strncpy(cmd.text, DEFAULT_LED_TEXT, sizeof(cmd.text) - 1);
        } else {
          strncpy(cmd.text, t.c_str(), sizeof(cmd.text) - 1);
        }
        cmd.text[sizeof(cmd.text) - 1] = '\0';
        // actual / target (จากตาชั่ง ESP32 อัปเดตผ่าน storeScaleWeight)
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
        xQueueSend(cmdQueue, &cmd, 0); // ส่งไปให้ loop() นำไปใช้
        s_ledStateFingerprint = buildFingerprintFromStateJson(doc.as<JsonObject>());
        Serial.println("[Poll] New command queued: " + String(cmd.text));
      }
    } else if (code > 0) {
      Serial.printf("[Poll] HTTP %d\n", code);
    } else {
      // ถ้า code < 0 แสดงว่าเชื่อมต่อไม่ได้ (ตรวจสอบ SERVER_URL)
      Serial.printf("[Poll] Error %d — ตรวจสอบ SERVER_URL=%s\n", code, g_serverUrl.c_str());
    }
    http.end();
  }
}

// ======================================================================
//  Serial fallback: text|actual|target|r|g|b
// ======================================================================
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

  // คำสั่งพิเศษ: !widths — พิมพ์ความกว้าง LED px ของอักขระสำคัญ (calibration)
  if (parts[0] == "!widths") {
    applyFont(1);
    Serial.println("=== etl14thai glyph advance widths ===");
    Serial.println("--- Thai (non-combining) ---");
    const char* thaiSamples[] = { "ก","ข","ค","ง","จ","ช","ร","น","ม","ย","ว","า","ะ","ๆ" };
    for (const char* ch : thaiSamples) {
      Serial.print(ch); Serial.print(": "); Serial.println(u8g2_for_gfx.getUTF8Width(ch));
    }
    Serial.println("--- ASCII digits ---");
    for (char c = '0'; c <= '9'; c++) {
      String s = String(c);
      Serial.print(c); Serial.print(": "); Serial.println(u8g2_for_gfx.getUTF8Width(s.c_str()));
    }
    Serial.println("--- ASCII letters (sample) ---");
    const char* asciiSamples[] = { "A","B","I","M","W","a","i","m","w" };
    for (const char* ch : asciiSamples) {
      Serial.print(ch); Serial.print(": "); Serial.println(u8g2_for_gfx.getUTF8Width(ch));
    }
    Serial.println("======================================");
    return;
  }

  // !W <text> — วัด LED px ของข้อความที่กำหนด
  if (parts[0].startsWith("!W ")) {
    String txt = parts[0].substring(3);
    applyFont(1);
    int px = getThaiTextWidth(txt);
    Serial.print("[measure] \""); Serial.print(txt);
    Serial.print("\" = "); Serial.print(px);
    Serial.println(px > 64 ? "px (SCROLL)" : "px (static)");
    return;
  }

  if (partCount == 1) {
    currentText = parts[0];
  } else if (partCount >= 3) {
    currentText  = parts[0];
    actualCount  = parts[1];
    targetCount  = parts[2];
    if (partCount == 6) {
      currentColor = dma_display->color565(
        parts[3].toInt(), parts[4].toInt(), parts[5].toInt()
      );
    }
  }
  updateTextProperties();
}

// ======================================================================
//  วาดและเลื่อนข้อความ
// ======================================================================
void drawAndScrollText() {
  if (millis() - lastScrollTime <= (unsigned long)scrollSpeed) return;
  lastScrollTime = millis();
  dma_display->clearScreen();

  // ---------- โซน 1 (จอ 1-2) ----------
  applyFont(currentFontSize);
  u8g2_for_gfx.setForegroundColor(currentColor);
  printThaiText(currentText, cursor_x, 14);

  // ตัดขอบที่ล้นเข้าจอ 3
  dma_display->fillRect(64, 0, 32, 16, dma_display->color565(0, 0, 0));

  // ---------- โซน 2 (จอ 3) ----------
  const uint8_t* numFonts[] = {
    u8g2_font_helvB08_tf,
    u8g2_font_6x10_tf,
    u8g2_font_5x7_tf,
    u8g2_font_4x6_tf
  };
  int numYOffsets[] = { 12, 12, 11, 11 };
  int bestFontIdx = 3;
  int gap = 2;

  for (int i = 0; i < 4; i++) {
    u8g2_for_gfx.setFont(numFonts[i]);
    int w_actual = u8g2_for_gfx.getUTF8Width(actualCount.c_str());
    int w_target = u8g2_for_gfx.getUTF8Width(targetCount.c_str());
    if (w_actual + w_target + gap <= 32) { bestFontIdx = i; break; }
  }

  u8g2_for_gfx.setFont(numFonts[bestFontIdx]);
  int draw_y   = numYOffsets[bestFontIdx];
  int w_actual = u8g2_for_gfx.getUTF8Width(actualCount.c_str());
  int w_target = u8g2_for_gfx.getUTF8Width(targetCount.c_str());

  if (32 - (w_actual + w_target) >= 6)      gap = 4;
  else if (32 - (w_actual + w_target) >= 4) gap = 3;

  int total_block_width = w_actual + gap + w_target;
  int start_x = 64 + ((32 - total_block_width) / 2);

  u8g2_for_gfx.setForegroundColor(dma_display->color565(0, 0, 255));
  u8g2_for_gfx.setCursor(start_x, draw_y);
  u8g2_for_gfx.print(actualCount);

  u8g2_for_gfx.setForegroundColor(dma_display->color565(0, 255, 0));
  u8g2_for_gfx.setCursor(start_x + w_actual + gap, draw_y);
  u8g2_for_gfx.print(targetCount);

  // ---------- เลื่อนโซน 1 ----------
  if (textWidth > 64) {
    cursor_x--;
    if (cursor_x < -textWidth) cursor_x = 64;
  }
}
