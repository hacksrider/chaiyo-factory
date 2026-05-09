/* ช่วยแก้ไขไฟล์นี้ถ้ามีสิ่งที่ต้องแก้ไข จะ Copy ไปอัปโหลดลง Code */
/*
  โปรแกรมควบคุมป้ายไฟ LED P10 (32x16) จำนวน 3 จอ (96x16) — รุ่น 1/4 Scan
  - โซน 1 (จอ 1-2): แสดงชื่อสินค้า (จำกัดการวาดไม่ให้ทะลุจอ 3)
  - โซน 2 (จอ 3): แสดงยอดที่ผลิตได้และเป้าหมาย (ปรับขนาดฟอนต์ และจัดกึ่งกลางแกน X อัตโนมัติ)

  การรับคำสั่ง (Polling + Reconcile อัตโนมัติ):
  - ESP32 เป็นฝ่าย poll ไปดึงคำสั่งคิว ทุก 2 วินาที
  - URL: GET {SERVER_URL}/api/production-monitor/led-command/{MACHINE_ID} (เฉพาะเมื่อเว็บ push คำสั่งใหม่)
  - นอกจากนี้: GET .../led-status/{MACHINE_ID} ทุก ~4 วิ เปรียบเทียบกับ “fingerprint” ล่าสุด
    → ถ้า state บนเซิร์ฟเวอร์ต่างจากที่ป้ายแสดง (รวม actual/target) จะส่งลง queue ให้ตรงกับหน้าเว็บโดย **ไม่ต้องกดซิงก์**
  - หลัง WiFi กลับมา: รีเซ็ต fingerprint แล้ว reconcile ทันที 2 รอบ ให้ตรง server อีกครั้ง
  - ไม่ต้องให้ PC รู้ IP ของ ESP32 — ESP32 เป็นฝ่ายเชื่อมต่อออกเอง
  - Serial fallback: text|actual|target|r|g|b

  WiFi (Multi-Network + DHCP อัตโนมัติ):
  - ESP32 จะสแกนสัญญาณ → เลือก SSID ที่รู้จักและ RSSI ดีที่สุดอัตโนมัติ
  - ใช้ DHCP — Router แจก IP เอง ไม่ต้อง hardcode IP ของป้ายในโค้ดหรือชีต
  - ESP32 รายงาน IP จริงของตัวเองมาที่ server ผ่าน polling ทุก 2 วินาที
    → เว็บรู้ IP ปัจจุบันเสมอ ไม่ว่าจะเชื่อม AP ไหน หรือ Router แจก IP เลขอะไรให้
  - เพิ่ม/แก้รายการ WiFi ได้ใน WIFI_PROFILES ด้านล่าง
  - SERVER_URL ใช้ "http://192.168.3.90:8080" เดียวกันทุก network
  - ตั้งค่า MACHINE_ID ให้ตรงกับ Machine ID ในชีต Settings (ไม่ต้องตั้ง LED_IP ในชีตแล้ว)

  ถอดปลั๊กแล้วเสียบใหม่แล้ว WiFi ไม่ขึ้น (สาเหตุที่พบบ่อย):
  - แรงดันตก (Brownout): จอ HUB75 กินไฟมากตอนบูต — ถ้า adapter เล็กไป ESP32 รีเซ็ตหรือ WiFi ล้มเหลว
    → ใช้ adapter กระแสเพียงพอ, สายสั้น, หรือลดความสว่างตอนบูต (โค้ดลด brightness ก่อน WiFi แล้วค่อยคืน)
  - Router ยังไม่พร้อม: ลองเชื่อมซ้ำอัตโนมัติ (boot retry + pollTask ช่วงห่าง ไม่สแกนถี่เกิน)

  หมายเหตุการแสดงผล (1/4 Scan):
  - ป้ายรุ่นนี้ใช้ 1/4 Scan — ต้องหลอกไลบรารีว่าเป็นจอ 64x8 (DMA_RES_X=64, DMA_RES_Y=8)
  - ใช้ P10_1_4_Display เป็น Pixel Mapper แปลงพิกัด physical → DMA ก่อนส่งออก
  - ห้ามเปลี่ยนส่วน display/pixel mapping นี้เด็ดขาด

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
#include <Preferences.h>

// ลดโอกาสรีเซ็ตจากไฟตกตอนบูต (HUB75 กินกระแสสูง)
#include "soc/rtc_cntl_reg.h"

// ======================================================================
//  ⚙️  ปรับค่าตรงนี้ก่อน upload ทุกชุด
// ======================================================================
#define MACHINE_ID  "EM 20"   // รหัสเครื่อง (ตรงกับ Machine ID ในชีต Settings)

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

// ======================================================================
// ---------------- กำหนดขนาดของหน้าจอ ----------------
// ขนาดทางกายภาพของป้าย P10 (ต่อ 1 แผ่น)
#define PHYSICAL_RES_X 32
#define PHYSICAL_RES_Y 16
#define PANEL_CHAIN 3

// สำหรับจอ 1/4 Scan ต้องหลอกไลบรารีว่าเป็นจอ 64x8
// เพื่อให้ ESP32 จ่ายสัญญาณ Clock ความยาว 64 บิตต่อรอบ (แก้ปัญหาจอแบ่งเป็น 2 ฝั่ง)
#define DMA_RES_X 64
#define DMA_RES_Y 8

// ความสว่าง: ตอนบูตลดก่อนเชื่อม WiFi ลดโอกาสแรงดันตก (Brownout) เมื่อถอดปลั๊กแล้วเสียบใหม่
#define PANEL_BRIGHTNESS_NORMAL    40
#define PANEL_BRIGHTNESS_WIFI_BOOT 8

// ---------------- ตัวแปรควบคุมหน้าจอ ----------------
MatrixPanel_I2S_DMA *dma_display = nullptr;

// ======================================================================
// 🛠️ คลาสช่วยแปลงพิกัด (Pixel Mapper) สำหรับจอ P10 Outdoor 1/4 Scan โดยเฉพาะ
// ======================================================================
class P10_1_4_Display : public Adafruit_GFX {
private:
    MatrixPanel_I2S_DMA* dma;
public:
    P10_1_4_Display(MatrixPanel_I2S_DMA* d) : Adafruit_GFX(PHYSICAL_RES_X * PANEL_CHAIN, PHYSICAL_RES_Y), dma(d) {}

    void drawPixel(int16_t x, int16_t y, uint16_t color) override {
        if (x < 0 || x >= width() || y < 0 || y >= height()) return;

        int panel_idx = x / PHYSICAL_RES_X;
        int local_x   = x % PHYSICAL_RES_X;

        // 🟢 สมการหลักที่คลีนที่สุด (ไม่มีแฮ็ก): จัดเรียงพิกเซลใหม่แบบ "บล็อก 8 ดวง สลับแถว"
        int block_idx      = local_x / 8;       // หาร 8 เพื่อหาว่าอยู่บล็อกไหน (จะได้ 0, 1, 2, 3)
        int pixel_in_block = local_x % 8;        // ลำดับดวงไฟในบล็อกนั้น (0 ถึง 7)

        // สลับครึ่งแรก(0) กับครึ่งหลัง(1) ของสายข้อมูล DMA
        int half = (y / 4) % 2;

        // คำนวณหาตำแหน่ง X ในหน่วยความจำ DMA อย่างปลอดภัย
        int dma_local_X = (block_idx * 16) + (half * 8) + pixel_in_block;

        // คำนวณหาตำแหน่ง Y และสัญญาณ R1/R2
        int dma_y = (y < 8) ? (y % 4) : (4 + (y % 4));

        int dma_X = (panel_idx * DMA_RES_X) + dma_local_X;
        dma->drawPixel(dma_X, dma_y, color);
    }

    void fillScreen(uint16_t color) override {
        dma->fillScreen(color); // ล้างบัฟเฟอร์แบบรวดเร็ว
    }
};

P10_1_4_Display *p10_display = nullptr; // ใช้ตัวนี้วาดรูป/ข้อความแทน dma_display
// ======================================================================

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

// fingerprint ล่าสุดที่ “ตรงกับ state บน server” แล้ว (กันยิง queue ซ้ำ + reconcile รู้ว่าเมื่อไหร่ต้องดึงใหม่)
static String s_ledStateFingerprint;
static const int         RECONCILE_EVERY_N_POLLS        = 2;  // 2 × 2s = ~4s
// WiFi reconnect exponential backoff — เริ่ม 2s → สูงสุด 60s (± 20% jitter)
static const uint32_t    WIFI_BACKOFF_MIN_MS            = 2000;
static const uint32_t    WIFI_BACKOFF_MAX_MS            = 60000;
static const uint32_t    WIFI_RECONNECT_INTERVAL_MS     = 5000; // legacy — replaced by backoff

// Persist last-known-good state in NVS so boot won't revert to DEFAULT_LED_TEXT
static Preferences s_prefs;
static const char* PREF_NS = "chaiyo_led";

void saveStateToPrefs() {
  String t = currentText;
  t.trim();
  if (t.length() == 0) return;
  if (t == "WiFi Error") return;
  if (t == "กำลังเชื่อมต่อ..") return;

  s_prefs.begin(PREF_NS, false);
  s_prefs.putString("text", t);
  s_prefs.putString("act",  actualCount);
  s_prefs.putString("tgt",  targetCount);
  // store 565 bits compactly (r5/g6/b5)
  s_prefs.putUChar("r", (uint8_t)((currentColor >> 11) & 0x1F));
  s_prefs.putUChar("g", (uint8_t)((currentColor >> 5)  & 0x3F));
  s_prefs.putUChar("b", (uint8_t)( currentColor        & 0x1F));
  s_prefs.putInt("fs", currentFontSize);
  s_prefs.putInt("sp", scrollSpeed);
  s_prefs.end();
}

bool loadStateFromPrefs() {
  s_prefs.begin(PREF_NS, true);
  String t  = s_prefs.getString("text", "");
  String a  = s_prefs.getString("act", "0");
  String tg = s_prefs.getString("tgt", "0");
  int fs    = s_prefs.getInt("fs", 1);
  int sp    = s_prefs.getInt("sp", 50);
  uint8_t r5 = s_prefs.getUChar("r", 0);
  uint8_t g6 = s_prefs.getUChar("g", 63);
  uint8_t b5 = s_prefs.getUChar("b", 31);
  s_prefs.end();

  t.trim();
  if (t.length() == 0) return false;

  currentText = t;
  actualCount = a;
  targetCount = tg;
  currentFontSize = fs;
  scrollSpeed = max(20, sp);
  if (dma_display) {
    currentColor = ((uint16_t)r5 << 11) | ((uint16_t)g6 << 5) | ((uint16_t)b5);
  }
  updateTextProperties();
  return true;
}

// แปลง JSON state / คิว / LedCmd เป็น string เดียวกัน
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

// Reconcile: นำ state ล่าสุดจาก /led-status มาเทียบ ถ้าไม่ตรงเว็บ → คิว (ไม่เรียก applyDefault)
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
    return;  // ไม่มี state บน server — ไม่ทับเนื้อหาจอ
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
//                 "fontSize":1, "speed":50, "actual":"0", "target":"100" }
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
    if (dma_display) currentColor = dma_display->color565(
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
//  คืน true ถ้า sync สำเร็จ (มี state จากเว็บ), false ถ้า fallback
// ======================================================================
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
    // อย่าทับด้วย DEFAULT — ให้ใช้ state ล่าสุด (Prefs) แล้ว reconcile ต่อไป
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();
  Serial.println("[Sync] Response: " + body.substring(0, 120)); // log 120 ตัวแรก

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, body)) {
    Serial.println("[Sync] JSON parse error — fallback default text");
    // อย่าทับด้วย DEFAULT
    return false;
  }

  if (!doc["success"].as<bool>() || !doc["hasState"].as<bool>()) {
    Serial.println("[Sync] ไม่มี state บนเซิร์ฟเวอร์ (hasState=false) — คืน state จาก NVS หรือ default");
    // คืน state ล่าสุดจาก NVS ก่อน (ป้องกันป้ายค้างที่ "กำลังเชื่อมต่อ.." หลัง WiFi เชื่อมสำเร็จ)
    if (!loadStateFromPrefs()) {
      applyDefaultLedVisual();
    }
    return false;
  }

  JsonObject st = doc["state"];
  if (st.isNull()) {
    Serial.println("[Sync] state เป็น null — fallback default text");
    // อย่าทับด้วย DEFAULT
    return false;
  }

  String txt = st["text"].as<String>();
  txt.trim();
  if (txt.length() == 0) {
    Serial.println("[Sync] ข้อความว่างบนเว็บ — default text");
    // อย่าทับด้วย DEFAULT
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
  saveStateToPrefs();
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
  WiFi.setSleep(false);     // กันอาการหลุด/ค้างจาก power-save บนบางบอร์ด
  WiFi.setTxPower(WIFI_POWER_19_5dBm); // เพิ่มกำลังส่ง (ช่วยในโรงงาน/สัญญาณอ่อน)
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
  Serial.println("Starting LED Matrix Panel (1/4 Scan)...");
  // Disable brownout detector (หลายชุดเจอรีเซ็ตวนเมื่อจอ HUB75 ดึงกระแสตอนบูต)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  HUB75_I2S_CFG mxconfig(DMA_RES_X, DMA_RES_Y, PANEL_CHAIN);

  // ปิดขา C, D, E ไม่ใช้สำหรับ 1/4 Scan
  mxconfig.gpio.c = -1;
  mxconfig.gpio.d = -1;
  mxconfig.gpio.e = -1;

  // =========================================================================
  // 🟢 Timing มาตรฐาน
  // =========================================================================
  mxconfig.clkphase      = false;
  mxconfig.latch_blanking = 4;
  mxconfig.i2sspeed      = HUB75_I2S_CFG::HZ_10M;
  // =========================================================================

  // 💡 เปิดระบบ Double Buffering
  mxconfig.double_buff = true;

  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();

  p10_display = new P10_1_4_Display(dma_display);

  // ลดความสว่างก่อน WiFi — จอ HUB75 กินไฟมาก ถ้าเต็มทันทีแรงดันอาจตกจน ESP32/WiFi ล้มเหลวหลังเสียบปลั๊ก
  dma_display->setBrightness8(PANEL_BRIGHTNESS_WIFI_BOOT);
  dma_display->clearScreen();
  delay(1200); // ให้ PSU นิ่งก่อน (ชุด PSU/ชิลด์บางตัวต้องรอมากขึ้น)

  u8g2_for_gfx.begin(*p10_display);

  // 💡 [แก้ไขจุดสำคัญที่สุด]: เปลี่ยนเป็นโหมดโปร่งใส (1)
  // ป้องกันปัญหากล่องข้อความสีดำไปลบข้อความข้างเคียงจนเกิดเป็นไฟกระพริบแหว่งๆ ตอนตัวหนังสือเลื่อน
  u8g2_for_gfx.setFontMode(1);
  u8g2_for_gfx.setFontDirection(0);

  if (dma_display) currentColor = dma_display->color565(0, 255, 255);
  updateTextProperties();

  // แสดง state ล่าสุดที่เคย sync ได้ทันที (กันบูตแล้วกลับไป DEFAULT_LED_TEXT)
  if (!loadStateFromPrefs()) {
    applyDefaultLedVisual();
  }

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
    if (dma_display) currentColor = dma_display->color565(cmd.r, cmd.g, cmd.b);
    // อัปเดต actual/target ถ้ามีใน command
    if (cmd.actual[0] != '\0') actualCount = String(cmd.actual);
    if (cmd.target[0] != '\0') targetCount = String(cmd.target);
    updateTextProperties();
    s_ledStateFingerprint = buildFingerprintFromLedCmd(cmd);
    Serial.println("[LED] Applied: " + currentText + " (" + actualCount + "/" + targetCount + ")");
    saveStateToPrefs();
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
  static uint32_t wifiBackoffMs            = WIFI_BACKOFF_MIN_MS;
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

      // ครั้งแรกหลุด: ลอง WiFi.reconnect() ทันที ไม่รอ interval
      if (!wifiImmediateRecoverTried) {
        wifiImmediateRecoverTried = true;
        Serial.println("[Poll] WiFi หลุด — ลอง reconnect ทันที");
        WiFi.reconnect();
        for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) {
          vTaskDelay(pdMS_TO_TICKS(200));
        }
        if (WiFi.status() == WL_CONNECTED) {
          continue; // กลับไป loop นอก branch (จะ reset state บรรทัดล่าง)
        }
      }

      // ── Exponential backoff reconnect ──────────────────────────────
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
          uint32_t next = min(wifiBackoffMs * 2, WIFI_BACKOFF_MAX_MS);
          int32_t jitter = (int32_t)(next * 0.2f) * (random(0, 200) - 100) / 100;
          wifiBackoffMs = (uint32_t)max((int32_t)WIFI_BACKOFF_MIN_MS, (int32_t)next + jitter);
          Serial.printf("[Poll] Next retry in %lums\n", wifiBackoffMs);
        }
      }
      continue;
    }

    // ───── เชื่อมอยู่ → รีเซ็ต state ─────
    bool justReconnected = showingConnecting;
    disconnectedSince = 0;
    lastReconnectMs   = 0;
    wifiBackoffMs     = WIFI_BACKOFF_MIN_MS; // reset on success
    showingConnecting = false;
    wifiImmediateRecoverTried = false;

    if (justReconnected) {
      vTaskDelay(pdMS_TO_TICKS(2000));
      Serial.println("[Poll] WiFi เชื่อมสำเร็จ — Reconcile กับเว็บ (ไม่ต้องกดซิงก์)...");
      s_ledStateFingerprint = "";  // บังคับเทียบ server อีกครั้ง
      reconcileLedStateWithWeb();
      vTaskDelay(pdMS_TO_TICKS(1500));
      reconcileLedStateWithWeb();
    }

    if (g_serverUrl.isEmpty()) continue;

    // ───── Reconcile: /led-status ทุก ~4s ให้ตรง actual/target + ข้อความ โดยไม่พึ่งกดซิงก์ ─────
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
        cmd.r        = doc["r"]        | 0;
        cmd.g        = doc["g"]        | 255;
        cmd.b        = doc["b"]        | 255;
        cmd.fontSize = doc["fontSize"] | 1;
        cmd.speed    = doc["speed"]    | 0;
        // actual / target (จากตาชั่ง ESP32 อัปเดตผ่าน storeScaleWeight)
        if (doc.containsKey("actual")) {
          strncpy(cmd.actual, doc["actual"].as<String>().c_str(), sizeof(cmd.actual) - 1);
          cmd.actual[sizeof(cmd.actual) - 1] = '\0';
        }
        if (doc.containsKey("target")) {
          strncpy(cmd.target, doc["target"].as<String>().c_str(), sizeof(cmd.target) - 1);
          cmd.target[sizeof(cmd.target) - 1] = '\0';
        }
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
      if (dma_display) currentColor = dma_display->color565(
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
  if (!dma_display || !p10_display) return;
  if (millis() - lastScrollTime <= (unsigned long)scrollSpeed) return;
  lastScrollTime = millis();

  // ล้างเฉพาะหน้าจอสำรอง (Back Buffer)
  dma_display->clearScreen();

  // ---------- โซน 1 (จอ 1-2) ----------
  applyFont(currentFontSize);
  u8g2_for_gfx.setForegroundColor(currentColor);
  printThaiText(currentText, cursor_x, 14);

  // ตัดขอบที่ล้นเข้าจอ 3
  p10_display->fillRect(64, 0, 32, 16, dma_display->color565(0, 0, 0));

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

  u8g2_for_gfx.setForegroundColor(dma_display->color565(0, 255, 0));
  u8g2_for_gfx.setCursor(start_x, draw_y);
  u8g2_for_gfx.print(actualCount);

  u8g2_for_gfx.setForegroundColor(dma_display->color565(255, 0, 0));
  u8g2_for_gfx.setCursor(start_x + w_actual + gap, draw_y);
  u8g2_for_gfx.print(targetCount);

  // ---------- เลื่อนโซน 1 ----------
  if (textWidth > 64) {
    cursor_x--;
    if (cursor_x < -textWidth) cursor_x = 64;
  }

  // 💡 สลับภาพที่วาดเสร็จแล้วทั้งหมดไปแสดงผลพร้อมกันทีเดียว (กำจัดแสงกระพริบ 100%)
  dma_display->flipDMABuffer();
}
