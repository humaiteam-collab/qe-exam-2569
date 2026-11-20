/**
 * ระบบสอบ QE 2569 — Google Apps Script (รุ่นที่ 3)
 * ผูกกับ Google Sheet "QE-2569"
 *
 * รองรับ (ส่งเป็น POST body JSON, Content-Type text/plain):
 *   (ไม่มี action) / "submit"  นิสิตส่งคำตอบ → แท็บคำตอบ (ชีต1)
 *   "getConfig"                โหลดการตั้งค่าที่แอดมินเผยแพร่ (โจทย์ที่เลือก เวลา แนวทาง)  — ไม่ต้องใช้รหัส
 *   "saveConfig"   [ADMIN_KEY] แอดมินเผยแพร่การตั้งค่า → แท็บ "ตั้งค่า"
 *   "upload"                   อัปโหลดไฟล์คำตอบ → Google Drive + แท็บ "ไฟล์แนบ"
 *                              (นิสิตอัปโหลดเองได้ / กรรมการอัปโหลดแทนต้องใช้ ADMIN_KEY)
 *   "list"         [ADMIN_KEY] กรรมการดึงคำตอบทั้งหมด + รายการไฟล์แนบ
 *   "getFile"      [ADMIN_KEY] กรรมการเปิดดูไฟล์แนบ (ส่งกลับเป็น base64)
 *   "manualSubmit" [ADMIN_KEY] กรรมการบันทึกคำตอบของนิสิตที่เขียนด้วยมือ → แท็บคำตอบ
 *   "grade"        [ADMIN_KEY] กรรมการบันทึกคะแนน → แท็บ "คะแนน"
 *
 * สิทธิ์: ADMIN_KEY = ผู้ดูแล (ทำได้ทุกอย่าง) · รหัสผู้ตรวจ (เช่น 6901) = กรรมการ
 *        กรรมการดึงคำตอบ เปิดไฟล์ ให้คะแนน นำเข้าคำตอบเขียนมือได้ แต่เผยแพร่การตั้งค่าไม่ได้
 *        รายชื่อผู้ตรวจเก็บใน Script property "GRADERS" (แอดมินแก้ผ่านหน้า #admin แล้วกดเผยแพร่)
 *
 * ตั้งค่าครั้งแรก:
 *   Project Settings → Script properties → ADMIN_KEY = รหัสที่ใช้ร่วมกับกรรมการ (ใช้ค่าเดิมได้)
 *   (ไม่บังคับ) UPLOAD_FOLDER_ID = รหัสโฟลเดอร์ Drive ที่จะเก็บไฟล์ ถ้าไม่ใส่ ระบบสร้างโฟลเดอร์ให้เอง
 */

var VERSION = 3;
var TZ = "Asia/Bangkok";
var MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
var SUBMIT_SHEET = "ชีต1";
var GRADE_SHEET = "คะแนน";
var FILE_SHEET = "ไฟล์แนบ";
var CONFIG_SHEET = "ตั้งค่า";
var UPLOAD_FOLDER_NAME = "QE-2569 ไฟล์แนบคำตอบ";
var CONFIG_CHUNK = 40000;

// หัวคอลัมน์แท็บคำตอบ: [หัวคอลัมน์, ชื่อฟิลด์ใน JSON]
var SUBMIT_COLUMNS = [
  ["ประทับเวลา (Timestamp)", "timestamp"],
  ["Full Name (ชื่อ-นามสกุล)", "fullName"],
  ["Student ID (รหัสนักศึกษา)", "studentId"],
  ["Cohort (รุ่น)", "cohort"],
  ["Level (ระดับ)", "level"],
  ["Language (ภาษา)", "language"],
  ["Exam Date (วันที่สอบ)", "examDate"],
  ["Start Time (เวลาเริ่มสอบ)", "startTime"],
  ["Question 1 (คำตอบข้อ 1)", "question1"],
  ["Question 2 (คำตอบข้อ 2)", "question2"],
  ["Question 3 (คำตอบข้อ 3)", "question3"],
  ["Last Autosave (บันทึกล่าสุด)", "lastAutosave"],
  ["Submit Status (สถานะการส่ง)", "submitStatus"],
  ["Submit Time (เวลาส่ง)", "submitTime"],
  ["Violation Count (จำนวนครั้งที่ละเมิด)", "violationCount"],
  ["Violation Log (บันทึกการละเมิด)", "violationLog"],
  ["Paste Attempts (ครั้งที่พยายามวาง)", "pasteAttempts"],
  ["Session ID (รหัสเซสชัน)", "sessionId"],
  ["Device (อุปกรณ์)", "device"],
  ["Screen (ขนาดหน้าจอ)", "screen"],
  ["Question Set (โจทย์ที่ใช้)", "questionSet"],
  ["Attachments (ไฟล์แนบ)", "attachments"],
  ["Submission Mode (รูปแบบการส่ง)", "submissionMode"]
];

var GRADE_COLUMNS = [
  ["ประทับเวลา (Timestamp)", "timestamp"],
  ["Grader Name (ชื่อผู้ให้คะแนน)", "graderName"],
  ["Grader Role (บทบาท)", "graderRole"],
  ["Student ID (รหัสนักศึกษา)", "studentId"],
  ["Full Name (ชื่อ-นามสกุล)", "fullName"],
  ["Subject (วิชา)", "subject"],
  ["Total (คะแนนรวม)", "total"],
  ["Verdict (ผลการประเมิน)", "verdict"],
  ["Category Checks (ผลการตรวจขั้นต่ำรายหมวด)", "categoryChecks"],
  ["Criterion Scores (คะแนนรายเกณฑ์)", "criterionScores"],
  ["Comments (หมายเหตุ)", "comments"],
  ["Oral Pass (ผ่านปากเปล่า)", "oralPass"],
  ["Ethics OK (ไม่มีข้อบกพร่องจริยธรรม)", "ethicsOk"],
  ["Grade ID (รหัสการให้คะแนน)", "gradeId"],
  ["Last Edited (แก้ไขล่าสุด)", "editedAt"],
  ["Edited By (ผู้แก้ไขล่าสุด)", "editedBy"],
  ["Edit Log (ประวัติการแก้ไข)", "editLog"]
];

var FILE_COLUMNS = [
  ["ประทับเวลา (Timestamp)", "timestamp"],
  ["Student ID (รหัสนักศึกษา)", "studentId"],
  ["Full Name (ชื่อ-นามสกุล)", "fullName"],
  ["Subject (วิชาที่)", "subject"],
  ["Subject Title (ชื่อวิชา)", "subjectTitle"],
  ["Question ID (รหัสโจทย์)", "bankId"],
  ["File Name (ชื่อไฟล์)", "fileName"],
  ["MIME Type (ชนิดไฟล์)", "mimeType"],
  ["Size (ขนาด ไบต์)", "size"],
  ["Drive File ID (รหัสไฟล์)", "fileId"],
  ["Drive URL (ลิงก์ไฟล์)", "url"],
  ["Uploaded By (ผู้อัปโหลด)", "uploadedBy"],
  ["Role (บทบาท)", "role"],
  ["Session ID (รหัสเซสชัน)", "sessionId"],
  ["Note (หมายเหตุ)", "note"]
];

// รหัสผู้ตรวจไม่เขียนไว้ในไฟล์นี้ เพราะไฟล์นี้อยู่ใน GitHub สาธารณะ
// ตั้งรหัสด้วยฟังก์ชัน setGraders() ในไฟล์ตั้งรหัสแยก (ไม่อัปขึ้น GitHub) หรือผ่านหน้า #admin แล้วกดเผยแพร่
var DEFAULT_GRADERS = [];

var ALLOWED_MIME = /^(application\/pdf|image\/[\w.+-]+|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/octet-stream)$/i;

/* ---------- entry points ---------- */

function doGet() {
  return json_({ ok: true, service: "QE-2569", version: VERSION });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "อ่านข้อมูลไม่ได้ (invalid JSON)" });
  }
  var action = String(body.action || "submit");
  try {
    switch (action) {
      case "submit": return json_(submit_(body, false));
      case "getConfig": return json_(getConfig_(body));
      case "saveConfig": requireAdmin_(body); return json_(saveConfig_(body));
      case "upload": return json_(upload_(body));
      case "list": return json_(list_(requireKey_(body)));
      case "getFile": requireKey_(body); return json_(getFile_(body));
      case "manualSubmit": requireKey_(body); return json_(submit_(body, true));
      case "grade": return json_(grade_(body, requireKey_(body)));
      default: return json_({ ok: false, error: "ไม่รู้จัก action: " + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ---------- actions ---------- */

function submit_(body, manual) {
  var sid = String(body.studentId || "").trim();
  if (!/^\d{10}$/.test(sid)) throw new Error("รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก");
  if (!String(body.fullName || "").trim()) throw new Error("กรุณาระบุชื่อ-นามสกุล");
  var data = {};
  SUBMIT_COLUMNS.forEach(function (c) { data[c[1]] = body[c[1]] == null ? "" : String(body[c[1]]); });
  data.timestamp = now_();
  if (manual) {
    if (!data.submissionMode) data.submissionMode = "เขียนด้วยมือ";
    if (!data.device) data.device = "manual";
  } else if (!data.submissionMode) {
    data.submissionMode = "ออนไลน์";
  }
  var row = appendRow_(sheet_(SUBMIT_SHEET, SUBMIT_COLUMNS, true), SUBMIT_COLUMNS, data);
  return { ok: true, row: row };
}

// บันทึกคะแนน: ถ้ามีรหัสการให้คะแนน (gradeId) เดิมอยู่แล้ว จะแก้แถวเดิม ไม่เพิ่มแถวซ้ำ
// ผู้ตรวจแก้ได้เฉพาะคะแนนที่ตนให้ · แอดมิน (ADMIN_KEY) แก้ได้ทุกรายการ โดยคงชื่อผู้ให้คะแนนเดิมไว้
function grade_(body, who) {
  var sh = sheet_(GRADE_SHEET, GRADE_COLUMNS, false);
  var gradeId = String(body.gradeId || "").trim();
  var existing = gradeId ? findRow_(sh, GRADE_COLUMNS, "gradeId", gradeId) : null;
  var data = {};
  GRADE_COLUMNS.forEach(function (c) { data[c[1]] = body[c[1]] == null ? "" : String(body[c[1]]); });
  var editor = who.role === "admin" ? "แอดมิน" : who.name + " (" + who.code + ")";

  if (existing) {
    var old = existing.data;
    if (who.role !== "admin" && old.graderName.indexOf(who.name) !== 0) {
      throw new Error("แก้ได้เฉพาะคะแนนที่ท่านให้เอง (แอดมินแก้ได้ทุกรายการ)");
    }
    data.timestamp = old.timestamp;
    data.graderName = old.graderName;
    data.graderRole = old.graderRole;
    data.editedAt = now_();
    data.editedBy = editor;
    var line = data.editedAt + " " + editor + ": รวม " + old.total + " → " + data.total + ", ผล " + old.verdict + " → " + data.verdict;
    data.editLog = (old.editLog ? old.editLog + "\n" : "") + line;
    writeRow_(sh, GRADE_COLUMNS, existing.row, data);
    return { ok: true, row: existing.row, updated: true };
  }

  data.timestamp = now_();
  if (who.role === "grader") data.graderName = who.name + " (" + who.code + ")";
  if (!data.gradeId) data.gradeId = "G-" + Utilities.getUuid();
  data.editedAt = "";
  data.editedBy = "";
  data.editLog = "";
  var row = appendRow_(sh, GRADE_COLUMNS, data);
  return { ok: true, row: row, updated: false, gradeId: data.gradeId };
}

function list_(who) {
  return {
    ok: true,
    version: VERSION,
    grader: { role: who.role, name: who.name || "", code: who.code || "" },
    uploadFolderUrl: uploadFolderUrl_(),
    submissions: readRows_(sheet_(SUBMIT_SHEET, SUBMIT_COLUMNS, true), SUBMIT_COLUMNS),
    files: readRows_(sheet_(FILE_SHEET, FILE_COLUMNS, false), FILE_COLUMNS),
    grades: readRows_(sheet_(GRADE_SHEET, GRADE_COLUMNS, false), GRADE_COLUMNS)
  };
}

function upload_(body) {
  var sid = String(body.studentId || "").trim();
  if (!/^\d{10}$/.test(sid)) throw new Error("รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก");
  var role = String(body.role || "student");
  if (role !== "student") {
    var who = requireKey_(body);
    if (who.role === "grader") body.uploadedBy = who.name;
  }
  var subject = String(body.subject || "");
  if (!/^[1-9]$/.test(subject)) throw new Error("ไม่ระบุวิชา");
  var b64 = String(body.data || "");
  if (!b64) throw new Error("ไม่มีข้อมูลไฟล์");
  var bytes = Utilities.base64Decode(b64);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("ไฟล์ใหญ่เกิน 10 MB");
  var mime = String(body.mimeType || "application/octet-stream");
  if (!ALLOWED_MIME.test(mime)) throw new Error("ไม่รองรับไฟล์ชนิดนี้ (" + mime + ")");
  var name = String(body.fileName || "file").replace(/[\\\/:*?"<>|]/g, "_").slice(0, 120);
  var stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
  var storedName = sid + "_S" + subject + "_" + stamp + "_" + name;

  var folder = studentFolder_(sid, String(body.fullName || ""));
  var file = folder.createFile(Utilities.newBlob(bytes, mime, storedName));
  file.setDescription("QE-2569 · " + sid + " · วิชาที่ " + subject + " · " + role);

  var rec = {
    timestamp: now_(),
    studentId: sid,
    fullName: String(body.fullName || ""),
    subject: subject,
    subjectTitle: String(body.subjectTitle || ""),
    bankId: String(body.bankId || ""),
    fileName: name,
    mimeType: mime,
    size: String(bytes.length),
    fileId: file.getId(),
    url: file.getUrl(),
    uploadedBy: String(body.uploadedBy || ""),
    role: role,
    sessionId: String(body.sessionId || ""),
    note: String(body.note || "")
  };
  appendRow_(sheet_(FILE_SHEET, FILE_COLUMNS, false), FILE_COLUMNS, rec);
  return { ok: true, fileId: rec.fileId, url: rec.url, name: name };
}

function getFile_(body) {
  var id = String(body.fileId || "");
  if (!id) throw new Error("ไม่ระบุไฟล์");
  // อนุญาตเฉพาะไฟล์ที่อยู่ในรายการแท็บไฟล์แนบ
  var known = readRows_(sheet_(FILE_SHEET, FILE_COLUMNS, false), FILE_COLUMNS).some(function (r) { return r.fileId === id; });
  if (!known) throw new Error("ไม่พบไฟล์ในระบบ");
  var file = DriveApp.getFileById(id);
  var blob = file.getBlob();
  return {
    ok: true,
    name: file.getName(),
    mimeType: blob.getContentType(),
    data: Utilities.base64Encode(blob.getBytes())
  };
}

function getConfig_(body) {
  var graders = getGraders_();
  var out = { ok: true, version: VERSION, graderCount: graders.length, config: null, graderNames: graders.map(function (g) { return g.name; }) };
  if (isAdmin_(body)) out.graders = getGraders_();
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG_SHEET);
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  var text = vals.map(function (r) { return String(r[0] || ""); }).join("");
  if (!text) return out;
  var meta = sh.getRange(1, 1, 1, 2).getDisplayValues()[0];
  out.config = JSON.parse(text);
  delete out.config.graders; // ไม่ส่งรหัสผู้ตรวจออกไปทางสาธารณะ
  out.updatedAt = meta[0];
  out.updatedBy = meta[1];
  return out;
}

function saveConfig_(body) {
  var parsed = typeof body.config === "string" ? JSON.parse(body.config) : (body.config || {});
  delete parsed.graders;
  var text = JSON.stringify(parsed);
  if (Array.isArray(body.graders)) {
    var clean = body.graders.filter(function (g) { return g && String(g.code || "").trim() && String(g.name || "").trim(); })
      .map(function (g) { return { code: String(g.code).trim(), name: String(g.name).trim() }; });
    if (clean.length) PropertiesService.getScriptProperties().setProperty("GRADERS", JSON.stringify(clean));
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(CONFIG_SHEET) || ss.insertSheet(CONFIG_SHEET);
    sh.clear();
    var chunks = [];
    for (var i = 0; i < text.length; i += CONFIG_CHUNK) chunks.push([text.slice(i, i + CONFIG_CHUNK)]);
    var at = now_();
    sh.getRange(1, 1, 1, 2).setNumberFormat("@").setValues([[at, String(body.updatedBy || "admin")]]);
    if (chunks.length) sh.getRange(2, 1, chunks.length, 1).setNumberFormat("@").setValues(chunks);
    if (!sh.isSheetHidden()) sh.hideSheet();
    return { ok: true, updatedAt: at, chunks: chunks.length };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- helpers ---------- */

function getGraders_() {
  var raw = PropertiesService.getScriptProperties().getProperty("GRADERS");
  if (raw) {
    try {
      var list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) return list;
    } catch (err) {}
  }
  return DEFAULT_GRADERS;
}

function isAdmin_(body) {
  var key = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  return !!key && String(body.adminKey || "") === key;
}

function requireAdmin_(body) {
  var key = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  if (!key) throw new Error("ยังไม่ได้ตั้ง ADMIN_KEY ใน Script properties");
  if (!isAdmin_(body)) throw new Error("ต้องใช้รหัสผู้ดูแล (ADMIN_KEY)");
  return { role: "admin", name: "", code: "" };
}

// ADMIN_KEY หรือรหัสผู้ตรวจ — คืนค่าว่าเป็นใคร
function requireKey_(body) {
  if (isAdmin_(body)) return { role: "admin", name: "", code: "" };
  var code = String(body.adminKey || "").trim();
  if (code) {
    var g = getGraders_().filter(function (x) { return String(x.code) === code; })[0];
    if (g) return { role: "grader", name: g.name, code: g.code };
  }
  throw new Error("รหัสผู้ตรวจไม่ถูกต้อง");
}

function now_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm:ss");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// หาแท็บตามชื่อ (ถ้าไม่มีให้สร้าง) และเติมหัวคอลัมน์ที่ยังขาดต่อท้าย โดยไม่ย้ายคอลัมน์เดิม
function sheet_(name, columns, fallbackFirst) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh && fallbackFirst) sh = ss.getSheets()[0];
  if (!sh) sh = ss.insertSheet(name);
  var lastCol = sh.getLastColumn();
  var head = lastCol ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  var missing = columns.map(function (c) { return c[0]; }).filter(function (h) { return head.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
    if (!head.length) sh.setFrozenRows(1);
  }
  return sh;
}

function headerIndex_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  var idx = {};
  head.forEach(function (h, i) { if (h) idx[h] = i; });
  return { head: head, idx: idx };
}

function appendRow_(sh, columns, data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var h = headerIndex_(sh);
    var row = new Array(h.head.length);
    for (var i = 0; i < row.length; i++) row[i] = "";
    columns.forEach(function (c) {
      var i = h.idx[c[0]];
      if (i != null) row[i] = data[c[1]] == null ? "" : String(data[c[1]]).slice(0, 49000);
    });
    var r = sh.getLastRow() + 1;
    // เก็บเป็นข้อความทั้งแถว เพื่อไม่ให้รหัสนักศึกษาที่ขึ้นต้นด้วย 0 หรือวันที่ถูกแปลง
    sh.getRange(r, 1, 1, row.length).setNumberFormat("@").setValues([row]);
    return r;
  } finally {
    lock.releaseLock();
  }
}

function findRow_(sh, columns, key, value) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var h = headerIndex_(sh);
  var vals = sh.getRange(2, 1, last - 1, h.head.length).getDisplayValues();
  var col = null;
  columns.forEach(function (c) { if (c[1] === key) col = h.idx[c[0]]; });
  if (col == null) return null;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (vals[i][col] === value) {
      var o = {};
      columns.forEach(function (c) { var j = h.idx[c[0]]; o[c[1]] = j == null ? "" : vals[i][j]; });
      return { row: i + 2, data: o };
    }
  }
  return null;
}

function writeRow_(sh, columns, r, data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var h = headerIndex_(sh);
    var row = sh.getRange(r, 1, 1, h.head.length).getValues()[0];
    columns.forEach(function (c) {
      var i = h.idx[c[0]];
      if (i != null && data[c[1]] != null) row[i] = String(data[c[1]]).slice(0, 49000);
    });
    sh.getRange(r, 1, 1, row.length).setNumberFormat("@").setValues([row]);
  } finally {
    lock.releaseLock();
  }
}

function readRows_(sh, columns) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var h = headerIndex_(sh);
  var vals = sh.getRange(2, 1, last - 1, h.head.length).getDisplayValues();
  return vals.filter(function (r) { return r.join("") !== ""; }).map(function (r) {
    var o = {};
    columns.forEach(function (c) {
      var i = h.idx[c[0]];
      o[c[1]] = i == null ? "" : r[i];
    });
    return o;
  });
}

function uploadRoot_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("UPLOAD_FOLDER_ID");
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) {}
  }
  var it = DriveApp.getFoldersByName(UPLOAD_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(UPLOAD_FOLDER_NAME);
  props.setProperty("UPLOAD_FOLDER_ID", folder.getId());
  return folder;
}

function uploadFolderUrl_() {
  var id = PropertiesService.getScriptProperties().getProperty("UPLOAD_FOLDER_ID");
  if (!id) return "";
  try { return DriveApp.getFolderById(id).getUrl(); } catch (err) { return ""; }
}

function studentFolder_(sid, name) {
  var root = uploadRoot_();
  var it = root.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(sid) === 0) return f;
  }
  return root.createFolder(sid + (name ? " " + name : ""));
}

/** รันครั้งเดียวจาก editor เพื่อขอสิทธิ์ Drive/Sheets และสร้างแท็บ/โฟลเดอร์ */
function setup() {
  sheet_(SUBMIT_SHEET, SUBMIT_COLUMNS, true);
  sheet_(GRADE_SHEET, GRADE_COLUMNS, false);
  sheet_(FILE_SHEET, FILE_COLUMNS, false);
  var folder = uploadRoot_();
  Logger.log("พร้อมใช้งาน · โฟลเดอร์ไฟล์แนบ: " + folder.getUrl());
}
