/*
  โปรแกรมควบคุมป้ายไฟ LED P10 (32x16) จำนวน 4 จอ (128x16)  — v2.3 (DNS fallback 8.8.8.8 + IP สำรอง)
  - โซน 1 (จอ 1-3): แสดงชื่อสินค้า
  - โซน 2 (จอ 4): แสดงยอดที่ผลิตได้และเป้าหมาย
  - เพิ่มระบบอ่านอุณหภูมิภายในตัวชิป (ESP32 Internal Temperature Sensor)
  - ดูอุณหภูมิผ่านหน้าเว็บโดยพิมพ์: http://<IP_ADDRESS>/temp
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
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
void showSyncWaitingVisual();
bool syncLedDisplayFromServer();
bool bootSyncFromServerWithRetry();
void pollTask(void* pv);
bool connectWifi(bool hardReset = true);
void processSerialCommand();
void drawAndScrollText();
String buildFingerprintFromLedCmd(const LedCmd& c);
void handleTemp();
void handleRoot();
void handleReboot();
String formatUptimeSec(unsigned long sec);
String rssiQualityLabel(int rssi);
String buildHeartbeatQuery();
void syncNtpIfNeeded(bool force = false);
int httpGetUrl(const String& url, String* bodyOut, uint32_t timeoutMs);
void recordCommandPollResult(int httpCode);
void maybeRestartAfterPollFailures(uint32_t nowMs);

// ======================================================================
//  ⚙️ ปรับค่าตรงนี้ก่อน upload ทุกชุด
// ======================================================================
#define MACHINE_ID  "EM 20"   // รหัสเครื่อง (ตรงกับ Machine ID ในชีต Settings)

// ── WiFi ที่ใช้งาน (เชื่อมเครือข่ายเดียว KANOK-AP เท่านั้น) ──────────
// IT สามารถ Fix IP ได้ผ่าน DHCP Reservation (ผูก MAC → IP ที่ Router)
// บอร์ดใช้ DHCP ปกติ — ถ้า IT ผูก MAC แล้วจะได้ IP คงที่อัตโนมัติ
#define WIFI_SSID   "KANOK-AP"
#define WIFI_PASS   "kanok2564"
#define WIFI_SERVER "https://www.chaiyo-factory.com"
#define SERVER_FALLBACK_IP "103.80.48.27"   // chaiyo-factory.com — ใช้เมื่อ DNS router ล้มเหลว

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
bool g_awaitingBootSync = true;
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
static const int         BOOT_SYNC_MAX_ATTEMPTS         = 8;
static const uint32_t    BOOT_SYNC_RETRY_MS             = 1500;
static const int         RECONCILE_EVERY_N_POLLS        = 2;
static const uint32_t    WIFI_BACKOFF_MIN_MS            = 2000;
static const uint32_t    WIFI_BACKOFF_MAX_MS            = 60000;
static const uint32_t    WIFI_RECONNECT_INTERVAL_MS     = 5000;
static const uint32_t    WIFI_HARD_RESET_AFTER_MS       = 120000;
static const uint32_t    WIFI_SCAN_CACHE_MS             = 180000;
static const uint32_t    NTP_RETRY_GAP_MS               = 10000;
static const uint32_t    NTP_RESYNC_INTERVAL_MS         = 3600000;
static const long        NTP_GMT_OFFSET_SEC             = 7 * 3600;  // Bangkok UTC+7
static bool              g_ntpClockConfigured           = false;
static bool              g_hasPreferredBssid            = false;
static uint8_t           g_preferredBssid[6]            = {0};
static int32_t           g_preferredChannel             = 0;
static uint32_t          g_lastWifiScanMs               = 0;
static const uint32_t    BOOT_SYNC_GIVE_UP_MS            = 90000;
static uint32_t          g_bootSyncWaitingSinceMs       = 0;
static const uint32_t    POLL_FAIL_STREAK_RESTART       = 90;    // ~3 นาที @ 2s/poll
static const uint32_t    POLL_STALE_RESTART_MS          = 600000; // 10 นาทีไม่ poll สำเร็จ
static int               g_lastPollHttpCode             = 0;
static int               g_lastSyncHttpCode              = 0;
static uint32_t          g_lastPollAttemptMs            = 0;
static uint32_t          g_lastPollSuccessMs            = 0;
static uint32_t          g_pollFailStreak               = 0;
static int               g_connectFailStreak              = 0;
static IPAddress         g_serverDnsIp;
static bool              g_serverDnsOk                    = false;
static bool              g_serverDnsFallback              = false;
static String            g_lastHttpError                  = "";

void applyPublicDns() {
  if (WiFi.status() != WL_CONNECTED) return;
  IPAddress routerDns = WiFi.dnsIP();
  IPAddress dns1(8, 8, 8, 8);
  IPAddress dns2(1, 1, 1, 1);
  WiFi.config(WiFi.localIP(), WiFi.gatewayIP(), WiFi.subnetMask(), dns1, dns2);
  Serial.printf("[DNS] router was %s → using %s + %s\n",
                routerDns.toString().c_str(), dns1.toString().c_str(), dns2.toString().c_str());
}

bool tryHostByName(const char* host, IPAddress& out) {
  for (int i = 0; i < 3; i++) {
    if (WiFi.hostByName(host, out) == 1) return true;
    vTaskDelay(pdMS_TO_TICKS(400));
  }
  return false;
}

String resolveServerHost() {
  if (g_serverUrl.isEmpty()) return "";
  int schemeEnd = g_serverUrl.indexOf("://");
  if (schemeEnd < 0) return "";
  int hostStart = schemeEnd + 3;
  int pathStart = g_serverUrl.indexOf('/', hostStart);
  return pathStart > hostStart
    ? g_serverUrl.substring(hostStart, pathStart)
    : g_serverUrl.substring(hostStart);
}

bool refreshServerDns() {
  String host = resolveServerHost();
  if (host.isEmpty()) {
    g_serverDnsOk = false;
    g_serverDnsFallback = false;
    g_lastHttpError = "no host";
    return false;
  }

  applyPublicDns();
  g_serverDnsFallback = false;

  if (tryHostByName(host.c_str(), g_serverDnsIp)) {
    g_serverDnsOk = true;
    Serial.printf("[DNS] OK %s → %s\n", host.c_str(), g_serverDnsIp.toString().c_str());
    return true;
  }

  if (host.startsWith("www.")) {
    String bare = host.substring(4);
    if (tryHostByName(bare.c_str(), g_serverDnsIp)) {
      g_serverDnsOk = true;
      Serial.printf("[DNS] OK %s → %s\n", bare.c_str(), g_serverDnsIp.toString().c_str());
      return true;
    }
  }

  if (g_serverDnsIp.fromString(SERVER_FALLBACK_IP)) {
    g_serverDnsOk = true;
    g_serverDnsFallback = true;
    g_lastHttpError = "dns ip fallback";
    Serial.println("[DNS] router DNS fail — using fallback IP " SERVER_FALLBACK_IP);
    return true;
  }

  g_serverDnsOk = false;
  g_serverDnsFallback = false;
  g_lastHttpError = "dns fail " + host;
  Serial.println("[HTTP] DNS fail: " + host);
  return false;
}

String extractUrlPath(const String& url) {
  int schemeEnd = url.indexOf("://");
  if (schemeEnd < 0) return url;
  int pathStart = url.indexOf('/', schemeEnd + 3);
  return pathStart >= 0 ? url.substring(pathStart) : "/";
}

int httpGetViaResolvedIp(const String& url, String* bodyOut, uint32_t timeoutMs) {
  String host = resolveServerHost();
  if (host.isEmpty() || !g_serverDnsOk) return -1;

  String path = extractUrlPath(url);
  String ipUrl = "https://" + g_serverDnsIp.toString() + path;
  HTTPClient http;
  http.setTimeout(timeoutMs);
  http.setReuse(false);
  WiFiClientSecure tls;
  tls.setInsecure();
  tls.setTimeout(timeoutMs / 1000 + 5);
  if (!http.begin(tls, ipUrl)) return -2;
  http.addHeader("Host", host);
  int code = http.GET();
  if (bodyOut && code == 200) *bodyOut = http.getString();
  http.end();
  return code;
}

int httpGetUrl(const String& url, String* bodyOut, uint32_t timeoutMs) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  if (!g_serverDnsOk) refreshServerDns();

  HTTPClient http;
  http.setTimeout(timeoutMs);
  http.setConnectTimeout(min(timeoutMs, (uint32_t)8000));
  http.setReuse(false);

  int code = -1;
  if (url.startsWith("https://")) {
    WiFiClientSecure tls;
    tls.setInsecure();
    tls.setTimeout(timeoutMs / 1000 + 5);
    if (!http.begin(tls, url)) {
      g_lastHttpError = "begin fail";
      return -2;
    }
    code = http.GET();
  } else {
    WiFiClient plain;
    plain.setTimeout(timeoutMs / 1000 + 5);
    if (!http.begin(plain, url)) {
      g_lastHttpError = "begin fail";
      return -2;
    }
    code = http.GET();
  }

  if (bodyOut && code == 200) {
    *bodyOut = http.getString();
  }
  http.end();

  if (code < 0 && url.startsWith("https://")) {
    g_lastHttpError = "tls:" + String(code);
    Serial.printf("[HTTP] TLS GET %d heap=%u — retry http.begin(url)\n", code, ESP.getFreeHeap());
    HTTPClient fb;
    fb.setTimeout(timeoutMs);
    fb.setReuse(false);
    if (fb.begin(url)) {
      code = fb.GET();
      if (bodyOut && code == 200) *bodyOut = fb.getString();
      if (code < 0) {
        g_lastHttpError = "fb:" + fb.errorToString(code);
        Serial.printf("[HTTP] fallback GET %d (%s) heap=%u\n",
                      code, g_lastHttpError.c_str(), ESP.getFreeHeap());
      }
    }
    fb.end();
  }

  // ต่อ IP ที่ resolve แล้ว + Host header (กรณี DNS router พัง หรือ TLS กับ hostname ไม่ผ่าน)
  if (code < 0 && url.startsWith("https://") && g_serverDnsOk) {
    Serial.printf("[HTTP] retry via IP %s heap=%u\n", g_serverDnsIp.toString().c_str(), ESP.getFreeHeap());
    int ipCode = httpGetViaResolvedIp(url, bodyOut, timeoutMs);
    if (ipCode >= 0) code = ipCode;
    else g_lastHttpError = "ip:" + String(ipCode);
  }

  if (code < 0) {
    if (g_lastHttpError.length() == 0 || g_lastHttpError == "begin fail") {
      g_lastHttpError = "conn fail";
    }
    if (code == HTTPC_ERROR_CONNECTION_REFUSED || code == HTTPC_ERROR_CONNECTION_LOST) {
      g_serverDnsOk = false;
    }
  } else {
    g_lastHttpError = "";
  }
  return code;
}

void recordCommandPollResult(int httpCode) {
  g_lastPollHttpCode = httpCode;
  g_lastPollAttemptMs = millis();
  if (httpCode == 200) {
    g_lastPollSuccessMs = g_lastPollAttemptMs;
    g_pollFailStreak = 0;
  } else {
    g_pollFailStreak++;
    Serial.printf("[Poll] HTTP %d — fail streak %u\n", httpCode, g_pollFailStreak);
  }
}

void maybeRestartAfterPollFailures(uint32_t nowMs) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (g_pollFailStreak >= POLL_FAIL_STREAK_RESTART) {
    Serial.printf("[Poll] fail streak %u — restarting ESP\n", g_pollFailStreak);
    ESP.restart();
  }
  if (g_lastPollSuccessMs > 0 && (nowMs - g_lastPollSuccessMs) >= POLL_STALE_RESTART_MS && g_pollFailStreak > 0) {
    Serial.println("[Poll] no successful poll for 10 min — restarting ESP");
    ESP.restart();
  }
}

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

void syncNtpIfNeeded(bool force) {
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

void showSyncWaitingVisual() {
  if (!dma_display) return;
  g_clockMode     = false;
  currentText     = "กำลังซิงก์..";
  currentFontSize = 1;
  scrollSpeed     = 50;
  currentColor    = dma_display->color565(255, 140, 0);
  actualCount     = "0";
  targetCount     = "0";
  updateTextProperties();
}

void applyClockVisual(uint8_t r = 0, uint8_t g = 255, uint8_t b = 0) {
  if (!dma_display) return;
  g_clockMode = true;
  currentFontSize = 1;
  scrollSpeed     = 50;
  currentColor    = dma_display->color565(r, g, b);
  actualCount     = "0";
  targetCount     = "0";
  char buf[16];
  formatClockTime(buf, sizeof(buf));
  currentText = String(buf);
  updateClockTextProperties();
  s_ledStateFingerprint = "|CLOCK|" + String(r) + "," + String(g) + "," + String(b) + "|1|50|0|0";
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
  g_awaitingBootSync = false;
  if (cmd.showClock || cmd.text[0] == '\0') {
    applyClockVisual(cmd.r, cmd.g, cmd.b);
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

  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/led-status/" + mid;
  String body;
  int code = httpGetUrl(url, &body, 4000);
  g_lastSyncHttpCode = code;
  if (code != 200) {
    Serial.printf("[Reconcile] HTTP %d (ข้าม — รอรอบถัดไป)\n", code);
    return;
  }

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
  if (WiFi.status() != WL_CONNECTED) return "";
  return "?localIp=" + WiFi.localIP().toString()
       + "&rssi=" + String(WiFi.RSSI())
       + "&uptime=" + String(millis() / 1000UL)
       + "&temp=" + String(g_internalTempC, 1);
}

void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : 0;
  uint32_t pollAgo = g_lastPollAttemptMs > 0 ? (millis() - g_lastPollAttemptMs) / 1000UL : 999999UL;
  uint32_t pollOkAgo = g_lastPollSuccessMs > 0 ? (millis() - g_lastPollSuccessMs) / 1000UL : 999999UL;
  String resp = "{\"ok\":true,\"machineId\":\"" + String(MACHINE_ID)
              + "\",\"ip\":\"" + WiFi.localIP().toString()
              + "\",\"mac\":\"" + WiFi.macAddress()
              + "\",\"wifiConnected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false")
              + ",\"rssi\":" + String(rssi)
              + ",\"rssiLabel\":\"" + rssiQualityLabel(rssi) + "\""
              + ",\"uptimeSec\":" + String(millis() / 1000UL)
              + ",\"uptime\":\"" + formatUptimeSec(millis() / 1000UL) + "\""
              + ",\"cpuTemperatureC\":" + String(g_internalTempC, 1)
              + ",\"lastPollHttpCode\":" + String(g_lastPollHttpCode)
              + ",\"lastSyncHttpCode\":" + String(g_lastSyncHttpCode)
              + ",\"pollFailStreak\":" + String(g_pollFailStreak)
              + ",\"lastPollAgoSec\":" + String(pollAgo)
              + ",\"lastPollOkAgoSec\":" + String(pollOkAgo)
              + ",\"serverUrl\":\"" + g_serverUrl + "\""
              + ",\"serverDnsOk\":" + String(g_serverDnsOk ? "true" : "false")
              + ",\"serverDnsFallback\":" + String(g_serverDnsFallback ? "true" : "false")
              + ",\"serverDnsIp\":\"" + (g_serverDnsOk ? g_serverDnsIp.toString() : String("")) + "\""
              + ",\"routerDns\":\"" + WiFi.dnsIP().toString() + "\""
              + ",\"freeHeap\":" + String(ESP.getFreeHeap())
              + ",\"lastHttpError\":\"" + g_lastHttpError + "\""
              + ",\"text\":\"" + currentText + "\"}";
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

// ─── ฟังก์ชันหน้าเว็บส่งค่าอุณหภูมิ ───
void handleTemp() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : 0;
  String resp = "{\"ok\":true,\"machineId\":\"" + String(MACHINE_ID)
              + "\",\"ip\":\"" + WiFi.localIP().toString()
              + "\",\"mac\":\"" + WiFi.macAddress()
              + "\",\"rssi\":" + String(rssi)
              + ",\"rssiLabel\":\"" + rssiQualityLabel(rssi) + "\""
              + ",\"uptimeSec\":" + String(millis() / 1000UL)
              + ",\"cpu_temperature_c\":" + String(g_internalTempC, 1) + "}";
  server.send(200, "application/json", resp);
}

void handleReboot() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String resp = "{\"ok\":true,\"message\":\"rebooting\",\"machineId\":\"" + String(MACHINE_ID) + "\"}";
  server.send(200, "application/json", resp);
  delay(250);
  ESP.restart();
}

// ─── หน้าเว็บหลัก (/) แสดงข้อมูลบอร์ด: IP, MAC Address ──────────────
void handleRoot() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String ip  = WiFi.localIP().toString();
  String mac = WiFi.macAddress();
  int rssi   = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : 0;
  String up  = formatUptimeSec(millis() / 1000UL);
  String html =
    "<!DOCTYPE html><html><head>"
    "<meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>LED Panel " + String(MACHINE_ID) + "</title>"
    "<style>body{font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px;}"
    "h2{color:#333}table{border-collapse:collapse;width:100%}"
    "td{padding:8px 12px;border:1px solid #ddd}td:first-child{font-weight:bold;background:#f5f5f5}"
    "a{color:#0066cc}hr{margin:20px 0}</style></head><body>"
    "<h2>&#128204; LED Panel: " + String(MACHINE_ID) + "</h2>"
    "<table>"
    "<tr><td>Machine ID</td><td>" + String(MACHINE_ID) + "</td></tr>"
    "<tr><td>IP Address</td><td>" + ip + "</td></tr>"
    "<tr><td>MAC Address</td><td><b>" + mac + "</b></td></tr>"
    "<tr><td>WiFi</td><td>KANOK-AP</td></tr>"
    "<tr><td>WiFi RSSI</td><td><b>" + String(rssi) + " dBm</b> (" + rssiQualityLabel(rssi) + ")</td></tr>"
    "<tr><td>Uptime</td><td>" + up + "</td></tr>"
    "<tr><td>CPU Temp</td><td>" + String(g_internalTempC, 1) + " &deg;C</td></tr>"
    "<tr><td>Text บนป้าย</td><td>" + currentText + "</td></tr>"
    "</table>"
    "<hr>"
    "<p><a href='/status'>&#128200; Status JSON</a> &nbsp;|&nbsp; "
    "<a href='/temp'>&#127777;&#65039; Temperature</a> &nbsp;|&nbsp; "
    "<a href='/update'>&#128640; OTA Update</a></p>"
    "</body></html>";
  server.send(200, "text/html", html);
}

bool syncLedDisplayFromServer() {
  if (!dma_display || g_serverUrl.isEmpty() || WiFi.status() != WL_CONNECTED) return false;

  String mid = String(MACHINE_ID);
  mid.replace(" ", "%20");
  String url = g_serverUrl + "/api/production-monitor/led-status/" + mid;
  Serial.println("[Sync] GET " + url);
  String body;
  int code = httpGetUrl(url, &body, 8000);
  g_lastSyncHttpCode = code;

  if (code != 200) {
    Serial.printf("[Sync] HTTP %d — รอ retry\n", code);
    return false;
  }

  Serial.println("[Sync] Response: " + body.substring(0, 120));

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, body)) {
    Serial.println("[Sync] JSON parse error — รอ retry");
    return false;
  }

  if (!doc["success"].as<bool>() || !doc["hasState"].as<bool>()) {
    Serial.println("[Sync] ไม่มี state บนเซิร์ฟเวอร์ — รอ led-command");
    if (g_awaitingBootSync) {
      g_awaitingBootSync = false;
      if (!g_clockMode && currentText == "กำลังซิงก์..") {
        applyClockVisual();
      }
    }
    return false;
  }

  JsonObject st = doc["state"];
  if (st.isNull()) {
    Serial.println("[Sync] state เป็น null — รอ retry");
    return false;
  }

  g_awaitingBootSync = false;

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

bool bootSyncFromServerWithRetry() {
  for (int attempt = 1; attempt <= BOOT_SYNC_MAX_ATTEMPTS; attempt++) {
    Serial.printf("[BootSync] attempt %d/%d\n", attempt, BOOT_SYNC_MAX_ATTEMPTS);
    if (syncLedDisplayFromServer()) return true;
    if (attempt < BOOT_SYNC_MAX_ATTEMPTS) vTaskDelay(pdMS_TO_TICKS(BOOT_SYNC_RETRY_MS));
  }
  showSyncWaitingVisual();
  Serial.println("[BootSync] ยังซิงก์ไม่ได้ — รอ poll/reconcile รอบถัดไป");
  return false;
}

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
    vTaskDelay(pdMS_TO_TICKS(300));
  }
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.setHostname(MACHINE_ID);

  // ใช้ DHCP — IT สามารถ fix IP ได้ผ่าน DHCP Reservation ที่ Router โดยใช้ MAC Address
  // บอร์ดนี้เชื่อมเฉพาะ KANOK-AP เท่านั้น
  Serial.printf("[WiFi] %s connect to \"%s\" ...\n", hardReset ? "Hard" : "Soft", WIFI_SSID);
  Serial.printf("[WiFi] MAC Address: %s\n", WiFi.macAddress().c_str());

  if (dma_display) {
    g_clockMode     = false;
    currentText     = "กำลังเชื่อมต่อ..";
    currentFontSize = 1;
    scrollSpeed     = 50;
    currentColor    = dma_display->color565(255, 140, 0);
    actualCount     = "0";
    targetCount     = "0";
    updateTextProperties();
    drawAndScrollText();
  }

  beginWifiWithBestAp();
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
      beginWifiWithBestAp();
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    g_connectFailStreak = 0;
    g_serverUrl = WIFI_SERVER;
    Serial.printf("\n[WiFi] ✓ Connected! IP: %s  MAC: %s\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.macAddress().c_str());
    vTaskDelay(pdMS_TO_TICKS(1500));
    applyPublicDns();
    syncNtpIfNeeded();
    refreshServerDns();
    bootSyncFromServerWithRetry();
    drawAndScrollText();
    return true;
  }
  g_connectFailStreak++;
  if (g_connectFailStreak >= 3) {
    g_hasPreferredBssid = false;
    g_lastWifiScanMs = 0;
    Serial.println("[WiFi] connect fail — clear BSSID lock for rescan");
  }
  Serial.println("\n[WiFi] Connection failed");
  return false;
}

void setup() {
  Serial.begin(115200);
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  // แสดง MAC Address ทันทีตอนเปิดเครื่อง (ก่อน WiFi เชื่อม) — ให้ IT นำไป fix IP ที่ Router
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

  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN);
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  dma_display->setBrightness8(PANEL_BRIGHTNESS_WIFI_BOOT);
  dma_display->clearScreen();
  delay(1200); 

  u8g2_for_gfx.begin(*dma_display);
  u8g2_for_gfx.setFontMode(0);
  u8g2_for_gfx.setFontDirection(0);

  g_awaitingBootSync = true;
  g_bootSyncWaitingSinceMs = millis();
  showSyncWaitingVisual();

  bool wifiOk = false;
  for (int bootTry = 0; bootTry < 10 && !wifiOk; bootTry++) {
    if (bootTry > 0) delay(3000);
    wifiOk = connectWifi();
  }
  if (wifiOk) syncNtpIfNeeded(true);

  dma_display->setBrightness8(PANEL_BRIGHTNESS_NORMAL);

  if (!wifiOk) {
    currentText = "WiFi Error";
    updateTextProperties();
  }

  // ลงทะเบียนหน้าเว็บ Endpoint ต่างๆ
  server.on("/",        HTTP_ANY, handleRoot);   // หน้าหลัก — แสดง IP + MAC Address
  server.on("/led",     HTTP_ANY, handleLed);
  server.on("/status",  HTTP_ANY, handleStatus);
  server.on("/measure", HTTP_ANY, handleMeasure);
  server.on("/temp",    HTTP_ANY, handleTemp);
  server.on("/reboot",  HTTP_ANY, handleReboot);
  
  ElegantOTA.begin(&server);
  server.begin();

  cmdQueue = xQueueCreate(3, sizeof(LedCmd));
  xTaskCreatePinnedToCore(pollTask, "pollTask", 12288, nullptr, 1, nullptr, 0);
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

  // ตอน WiFi หลุด → แสดงนาฬิกา HH:MM:SS ทันที
  auto sendOfflineClock = []() {
    if (!cmdQueue) return;
    LedCmd cmd = {};
    cmd.showClock = true;
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
        g_awaitingBootSync = true;
        g_bootSyncWaitingSinceMs = now;
        s_ledStateFingerprint = "";  // ล้าง fingerprint ให้ reconcile ทำงานซ้ำได้
        g_serverDnsOk = false;
      }
      if (!showingConnecting) {
        showingConnecting = true;
        sendOfflineClock();          // แสดงนาฬิกาทันทีที่ WiFi หลุด
      }

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
        if (WiFi.status() != WL_CONNECTED) {
          bool hardReset = (disconnectedFor >= WIFI_HARD_RESET_AFTER_MS);
          connectWifi(hardReset);
          if (WiFi.status() != WL_CONNECTED && !hardReset && disconnectedFor >= 60000) {
            connectWifi(true);
          }
        }
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

    // ─── Log RSSI ทุก 30 วินาที เพื่อ diagnose signal ──────────────────
    static uint32_t s_lastRssiLogMs = 0;
    if (currentMs - s_lastRssiLogMs >= 30000UL || s_lastRssiLogMs == 0) {
      s_lastRssiLogMs = currentMs;
      int rssi = WiFi.RSSI();
      Serial.printf("[WiFi] RSSI: %d dBm%s\n", rssi,
        rssi < -75 ? " ⚠️ WEAK" : (rssi < -60 ? " OK" : " GOOD"));
    }

    if (justReconnected) {
      g_awaitingBootSync = true;
      g_bootSyncWaitingSinceMs = currentMs;
      vTaskDelay(pdMS_TO_TICKS(1500));
      applyPublicDns();
      refreshServerDns();
      syncNtpIfNeeded(true);
      s_ledStateFingerprint = "";
      bootSyncFromServerWithRetry();
    }

    if (g_awaitingBootSync) {
      if (g_bootSyncWaitingSinceMs > 0
          && (currentMs - g_bootSyncWaitingSinceMs) >= BOOT_SYNC_GIVE_UP_MS) {
        g_awaitingBootSync = false;
        g_bootSyncWaitingSinceMs = 0;
        if (!g_clockMode && currentText == "กำลังซิงก์..") {
          Serial.println("[Sync] boot sync timeout — show clock until command");
          applyClockVisual();
        }
      } else {
        syncLedDisplayFromServer();
      }
    }

    if (g_serverUrl.isEmpty()) continue;

    pollCycle++;
    if (pollCycle % RECONCILE_EVERY_N_POLLS == 0) reconcileLedStateWithWeb();

    String mid = String(MACHINE_ID);
    mid.replace(" ", "%20");
    
    String url = g_serverUrl + "/api/production-monitor/led-command/" + mid + buildHeartbeatQuery();
    String body;
    int code = httpGetUrl(url, &body, 5000);
    recordCommandPollResult(code);
    maybeRestartAfterPollFailures(currentMs);

    if (code == 200) {
      StaticJsonDocument<1024> doc;
      if (!deserializeJson(doc, body) && doc["pending"].as<bool>()) {
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
        g_awaitingBootSync = false;
        g_bootSyncWaitingSinceMs = 0;
        s_ledStateFingerprint = buildFingerprintFromStateJson(doc.as<JsonObject>());
      }
    }
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