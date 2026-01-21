/**
 * SUBSCRIBER PRO - ENTERPRISE MASTER (v12.3 - Professional Edition)
 * -----------------------------------------------------------------------
 * AUTHOR: S-PRO System
 * * CORE FEATURES:
 * 1.  WEBHOOK ROUTER: Centralized doGet/doPost for all API requests.
 * 2.  GMAIL HUB: Sends professional HTML emails with tracking integration.
 * 3.  PIXEL ENGINE: Tracks email "Opens" via invisible 1x1 image triggers.
 * 4.  CRUD OPERATIONS: Create, Read, Update, and Delete subscriber nodes.
 * 5.  HISTORY ENGINE: Real-time retrieval of Gmail threads for any subscriber.
 * 6.  SECURITY: Master Key (apple123) protection for all private data.
 * 7.  QUOTA SENSOR: Monitors remaining daily Google email limits.
 * 8.  CONCURRENCY LOCK: Prevents spreadsheet corruption during high traffic.
 * 9.  REPLY-TO ROUTING: Directs subscriber replies to designated support mail.
 * 10. AUTO-SCHEMA: Automatically initializes spreadsheet headers if missing.
 * -----------------------------------------------------------------------
 */

// --- [GLOBAL CONFIGURATION] ---
const MY_SECRET_WORD = "apple123"; 
const ADMIN_PASSWORD = "admin123"; // TODO: Change this before production
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const MAX_LOGIN_ATTEMPTS = 5;
const ATTEMPT_LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes lockout
const SEND_WELCOME_EMAIL = "true"; 
const SENDER_NAME = "Your Brand Name";
const REPLY_TO_EMAIL = "support@yourdomain.com";

/**
 * SESSION & AUTHENTICATION FUNCTIONS
 */
function generateSessionToken() {
  return Utilities.getUuid();
}

function getSessionData(token) {
  const cache = CacheService.getUserCache();
  const sessionData = cache.get(`session_${token}`);
  return sessionData ? JSON.parse(sessionData) : null;
}

function createSession(password) {
  if (password !== ADMIN_PASSWORD) {
    recordFailedLogin();
    return { success: false, message: "Invalid password", token: null, expiresAt: null };
  }
  
  const token = generateSessionToken();
  const expiresAt = Date.now() + SESSION_DURATION;
  const sessionData = {
    token: token,
    createdAt: Date.now(),
    expiresAt: expiresAt,
    loginTime: new Date().toISOString()
  };
  
  const cache = CacheService.getUserCache();
  cache.put(`session_${token}`, JSON.stringify(sessionData), SESSION_DURATION / 1000);
  cache.remove(`login_attempts`);
  
  return { 
    success: true, 
    message: "Login successful", 
    token: token, 
    expiresAt: expiresAt 
  };
}

function validateSession(token) {
  if (!token) return false;
  
  const cache = CacheService.getUserCache();
  const sessionData = cache.get(`session_${token}`);
  
  if (!sessionData) return false;
  
  const session = JSON.parse(sessionData);
  if (Date.now() > session.expiresAt) {
    cache.remove(`session_${token}`);
    return false;
  }
  
  return true;
}

function killSession(token) {
  const cache = CacheService.getUserCache();
  cache.remove(`session_${token}`);
  return true;
}

function recordFailedLogin() {
  const cache = CacheService.getUserCache();
  const key = `login_attempts`;
  const currentAttempts = cache.get(key) ? parseInt(cache.get(key)) : 0;
  const newAttempts = currentAttempts + 1;
  
  cache.put(key, newAttempts.toString(), ATTEMPT_LOCKOUT_DURATION / 1000);
  
  return {
    attempts: newAttempts,
    maxAttempts: MAX_LOGIN_ATTEMPTS,
    isLocked: newAttempts >= MAX_LOGIN_ATTEMPTS
  };
}

function isAccountLocked() {
  const cache = CacheService.getUserCache();
  const key = `login_attempts`;
  const attempts = cache.get(key) ? parseInt(cache.get(key)) : 0;
  return attempts >= MAX_LOGIN_ATTEMPTS;
}

/**
 * Main GET Request Handler
 * Handles: Tracking, Dashboard Data, Gmail History, and Public Actions.
 */
function doGet(e) {
  // SAFE GUARD: Handle manual execution in the script editor
  if (!e || !e.parameter) {
    return ContentService.createTextOutput("System Online. Event object 'e' is undefined because you ran this manually. To test, please use the Web App URL or the testDoGet() function.").setMimeType(ContentService.MimeType.TEXT);
  }

  const params = e.parameter;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Subscribers") || initializeSheet(ss);

  // --- ACTION: ADMIN LOGIN (Public) ---
  if (params.action === "login" && params.password) {
    if (isAccountLocked()) {
      return createJsonResponse({ 
        success: false, 
        message: "Too many failed attempts. Please try again in 15 minutes.",
        locked: true,
        token: null
      });
    }
    
    const loginResult = createSession(params.password);
    
    if (!loginResult.success) {
      const failureRecord = recordFailedLogin();
      return createJsonResponse({ 
        success: false, 
        message: `Invalid password. Attempts: ${failureRecord.attempts}/${failureRecord.maxAttempts}`,
        attemptsLeft: MAX_LOGIN_ATTEMPTS - failureRecord.attempts,
        locked: failureRecord.isLocked,
        token: null
      });
    }
    
    return createJsonResponse(loginResult);
  }

  // --- ACTION: LOGOUT (Public) ---
  if (params.action === "logout" && params.token) {
    killSession(params.token);
    return createJsonResponse({ success: true, message: "Logged out successfully" });
  }

  // --- ACTION: TRACKING PIXEL (Public) ---
  if (params.action === "track" && params.email) {
    updateMetric(params.email, "opens");
    return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT); 
  }

  // --- ACTION: CTA CLICK TRACKING (Public) ---
  if (params.action === "click" && params.email) {
    updateMetric(params.email, "clicks");
    if (params.redirect) {
      return HtmlService.createHtmlOutput(`<script>window.location.href='${decodeURIComponent(params.redirect)}';</script>`);
    }
    return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
  }

  // --- ACTION: PUBLIC WEBHOOKS (Subscribe/Unsubscribe) ---
  if (params.action === "subscribe" && params.email) {
    return handlePublicAction(sheet, params.email, params.name || "Web Subscriber", "active", "Successfully Subscribed!");
  }
  
  if (params.action === "unsubscribe" && params.email) {
    return handlePublicAction(sheet, params.email, "", "unsubscribed", "Successfully Unsubscribed.");
  }

  // --- ACTION: VIEW ALL SUBSCRIBERS (PUBLIC - No Auth Required) ---
  if (params.action === "viewAll" && params.key === MY_SECRET_WORD) {
    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return createJsonResponse({ data: [], stats: { total: 0 } });
    
    const headers = ["id", "name", "email", "status", "date", "opens", "clicks"];
    let jsonArray = values.slice(1).map(row => {
      let obj = {};
      headers.forEach((h, i) => {
        let val = row[i];
        if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
        obj[h] = val;
      });
      return obj;
    });

    return createJsonResponse({
      data: jsonArray.reverse(), 
      stats: {
        total: jsonArray.length,
        active: jsonArray.filter(i => i.status === 'active').length,
        totalOpens: jsonArray.reduce((sum, i) => sum + (Number(i.opens) || 0), 0),
        totalClicks: jsonArray.reduce((sum, i) => sum + (Number(i.clicks) || 0), 0),
        remainingEmails: MailApp.getRemainingDailyQuota(),
        systemStatus: SEND_WELCOME_EMAIL === "true" ? "ONLINE" : "OFFLINE"
      }
    });
  }

  // --- SESSION TOKEN VALIDATION FOR DASHBOARD ---
  if (!params.token || !validateSession(params.token)) {
    return createJsonResponse({ 
      success: false, 
      message: "Unauthorized - Invalid or expired session",
      requiresLogin: true
    });
  }

  // --- ACTION: CONVERSATION LOAD (Gmail History) ---
  if (params.action === "getConversation" && params.email) {
    try {
      const threads = GmailApp.search(`to:${params.email} OR from:${params.email}`, 0, 15);
      const history = threads.map(thread => {
        return thread.getMessages().map(m => ({
          timestamp: m.getDate(),
          from: m.getFrom(),
          subject: m.getSubject(),
          body: m.getPlainBody().substring(0, 1000), 
          isSubscriber: m.getFrom().includes(params.email)
        }));
      }).flat().sort((a,b) => b.timestamp - a.timestamp);
      return createJsonResponse({ success: true, history: history });
    } catch(err) {
      return createJsonResponse({ success: false, message: "History Fetch Error", history: [] });
    }
  }

  // --- ACTION: QUOTA CHECK ---
  if (params.action === "getQuota") {
    return createJsonResponse({ remaining: MailApp.getRemainingDailyQuota() });
  }

  // --- DASHBOARD DATA & STATS ENGINE ---
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return createJsonResponse({ data: [], stats: { total: 0 } });
  
  const headers = ["id", "name", "email", "status", "date", "opens", "clicks"];
  let jsonArray = values.slice(1).map(row => {
    let obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
      obj[h] = val;
    });
    return obj;
  });

  return createJsonResponse({
    data: jsonArray.reverse(), 
    stats: {
      total: jsonArray.length,
      active: jsonArray.filter(i => i.status === 'active').length,
      totalOpens: jsonArray.reduce((sum, i) => sum + (Number(i.opens) || 0), 0),
      totalClicks: jsonArray.reduce((sum, i) => sum + (Number(i.clicks) || 0), 0),
      remainingEmails: MailApp.getRemainingDailyQuota(),
      systemStatus: SEND_WELCOME_EMAIL === "true" ? "ONLINE" : "OFFLINE"
    }
  });
}

/**
 * Main POST Request Handler
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); 
    if (!e || !e.postData || !e.postData.contents) {
       return createJsonResponse({ success: false, message: "No data received" });
    }
    const data = JSON.parse(e.postData.contents);
    
    if (data.key !== MY_SECRET_WORD) return createJsonResponse({ success: false, message: "Invalid API Key" });
    if (!data.token || !validateSession(data.token)) {
      return createJsonResponse({ success: false, message: "Unauthorized - Invalid or expired session", requiresLogin: true });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Subscribers") || initializeSheet(ss);

    // --- ACTION: UPDATE SUBSCRIBER STATUS ---
    if (data.action === "updateStatus" && data.email && data.status) {
      return handlePublicAction(sheet, data.email, "", data.status, `Status updated to ${data.status}`);
    }

    // --- ACTION: ADD SUBSCRIBER ---
    if (data.action === "addSubscriber" && data.email && data.name) {
      const currentData = sheet.getDataRange().getValues();
      const emailToFind = data.email.toLowerCase();
      
      if (currentData.some(r => r[2] && r[2].toString().toLowerCase() === emailToFind)) {
        return createJsonResponse({ success: false, message: "Subscriber already exists" });
      }

      sheet.appendRow(["ID-"+Date.now(), data.name, data.email, "active", new Date(), 0, 0]);
      
      if (SEND_WELCOME_EMAIL === "true") {
        sendPremiumEmail(data.email, data.name);
      }

      return createJsonResponse({ success: true, message: "Subscriber added successfully" });
    }

    // --- ACTION: SEND EMAIL ---
    if (data.action === "sendEmail" && data.to && data.subject && data.body) {
      GmailApp.sendEmail(data.to, data.subject, data.body, {
        name: data.senderName || SENDER_NAME,
        replyTo: REPLY_TO_EMAIL,
        htmlBody: data.body 
      });
      return createJsonResponse({ success: true, message: "Email sent successfully" });
    }

    // --- METHOD: COMPOSE HUB (Legacy) ---
    if (data.method === "COMPOSE") {
      GmailApp.sendEmail(data.to, data.subject, data.body, {
        name: data.senderName || SENDER_NAME,
        replyTo: REPLY_TO_EMAIL,
        htmlBody: data.body 
      });
      return createJsonResponse({ success: true, message: "Email Dispatched Successfully" });
    }

    // --- METHOD: MANUAL SUBSCRIBER INJECTION ---
    const currentData = sheet.getDataRange().getValues();
    const emailToFind = data.email.toLowerCase();
    
    if (currentData.some(r => r[2] && r[2].toString().toLowerCase() === emailToFind)) {
      return createJsonResponse({ success: false, message: "Node Already Exists" });
    }

    sheet.appendRow(["ID-"+Date.now(), data.name || "Subscriber", data.email, "active", new Date(), 0, 0]);
    
    if (SEND_WELCOME_EMAIL === "true") {
      sendPremiumEmail(data.email, data.name || "Subscriber");
    }

    return createJsonResponse({ success: true, message: "Subscriber Synchronized" });

  } catch (err) {
    return createJsonResponse({ success: false, message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Sends a beautiful welcome email with tracking pixel.
 */
function sendPremiumEmail(email, name) {
  const scriptUrl = ScriptApp.getService().getUrl();
  const trackingPixel = `${scriptUrl}?action=track&email=${encodeURIComponent(email)}&ts=${Date.now()}`;
  const ctaLink = `${scriptUrl}?action=click&email=${encodeURIComponent(email)}&redirect=${encodeURIComponent('https://yoursite.com')}`;

  const htmlBody = `
    <div style="background-color:#f8fafc; padding:40px 20px; font-family:'Segoe UI', -apple-system, sans-serif; color:#1e293b;">
      <div style="max-width:500px; margin:0 auto; background-color:#ffffff; padding:40px; border-radius:12px; box-shadow:0 4px 6px rgba(0,0,0,0.07); border:1px solid #e2e8f0;">
        
        <!-- Logo -->
        <div style="text-align:center; margin-bottom:30px;">
          <img src="https://img.icons8.com/clouds/100/high-five.png" alt="Logo" style="max-width:80px; height:auto; display:block; margin:0 auto;">
        </div>

        <!-- Header -->
        <div style="text-align:center; margin-bottom:30px;">
          <h1 style="color:#3b82f6; font-size:28px; margin:0 0 10px 0; font-weight:700;">Thank You! 🎉</h1>
          <p style="color:#64748b; font-size:14px; margin:0;">You're officially subscribed</p>
        </div>

        <!-- Main Message -->
        <div style="margin-bottom:30px;">
          <p style="color:#475569; font-size:15px; line-height:1.6; margin:0 0 15px 0;">
            Hi ${name},
          </p>
          <p style="color:#475569; font-size:15px; line-height:1.6; margin:0;">
            Thanks for subscribing! We're excited to have you in our community. You'll now receive updates and exclusive content directly to your inbox.
          </p>
        </div>

        <!-- CTA Button -->
        <div style="text-align:center; margin:30px 0;">
          <a href="${ctaLink}" style="display:inline-block; padding:12px 32px; background-color:#3b82f6; color:white; text-decoration:none; border-radius:6px; font-weight:600; font-size:14px; transition:background-color 0.2s;">
            Explore Now
          </a>
        </div>

        <!-- Divider -->
        <div style="border-top:1px solid #e2e8f0; margin:30px 0;"></div>

        <!-- Footer Info -->
        <div style="font-size:13px; color:#94a3b8; text-align:center;">
          <p style="margin:10px 0;">Questions? <a href="mailto:${REPLY_TO_EMAIL}" style="color:#3b82f6; text-decoration:none;">Get in touch</a></p>
          <p style="margin:10px 0;">© ${new Date().getFullYear()} ${SENDER_NAME}</p>
        </div>

      </div>
      <img src="${trackingPixel}" width="1" height="1" style="display:none !important;" />
    </div>
  `;

  GmailApp.sendEmail(email, "Thanks for subscribing! 🎉", "", {
    name: SENDER_NAME,
    replyTo: REPLY_TO_EMAIL,
    htmlBody: htmlBody
  });
}

/**
 * Updates Opens/Clicks metrics in the spreadsheet.
 */
function updateMetric(email, type) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Subscribers");
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const colIndex = (type === "opens") ? 5 : 6; 

  for (let i = 1; i < data.length; i++) {
    if (data[i][2] && data[i][2].toString().toLowerCase() === email.toLowerCase()) {
      const current = Number(data[i][colIndex]) || 0;
      sheet.getRange(i + 1, colIndex + 1).setValue(current + 1);
      break;
    }
  }
}

/**
 * Handles Subscriber/Unsubscriber logic for public links and trash buttons.
 */
function handlePublicAction(sheet, email, name, status, msg) {
  const data = sheet.getDataRange().getValues();
  let foundRow = -1;
  const emailToFind = email.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (data[i][2] && data[i][2].toString().toLowerCase() === emailToFind) { foundRow = i + 1; break; }
  }

  if (foundRow !== -1) {
    if (status === "unsubscribed") {
      sheet.deleteRow(foundRow); 
    } else {
      sheet.getRange(foundRow, 4).setValue(status);
    }
  } else if (status === "active") {
    sheet.appendRow(["ID-"+Date.now(), name || "Lead", email, status, new Date(), 0, 0]);
    if (SEND_WELCOME_EMAIL === "true") sendPremiumEmail(email, name || "New Subscriber");
  }
  return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Initializes the sheet with enterprise headers if they don't exist.
 */
function initializeSheet(ss) {
  let sheet = ss.getSheetByName("Subscribers");
  if (!sheet) {
    sheet = ss.insertSheet("Subscribers");
    sheet.appendRow(["ID", "Name", "Email", "Status", "Date Joined", "Opens", "Clicks"]);
    sheet.getRange("A1:G1").setBackground("#4f46e5").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Standardized JSON output utility.
 */
function createJsonResponse(output) {
  return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * DEBUGGING TOOL: Run this function in the editor to test doGet without errors.
 */
function testDoGet() {
  const mockEvent = {
    parameter: {
      key: MY_SECRET_WORD,
      action: "getQuota"
    }
  };
  const response = doGet(mockEvent);
  Logger.log(response.getContent());
}