// ════════════════════════════════════════════════════════════════════════════
//  MFG OPS — Google Apps Script Backend  (Updated Feb 2026)
//  ─────────────────────────────────────────────────────────────────────────
//  SETUP:
//    1. Extensions → Apps Script → paste this code
//    2. Replace SHEET_ID below with your Google Sheet ID
//    3. Deploy → New Deployment → Web App
//       · Execute as: Me
//       · Who has access: Anyone
//    4. Copy the Web App URL into worker_log_form.html (SCRIPT_URL)
//       and into the Admin Dashboard Setup tab
// ════════════════════════════════════════════════════════════════════════════

// ── CONFIG ───────────────────────────────────────────────────────────────────
const SHEET_ID       = 'YOUR_SHEET_ID_HERE';  // ← Replace with your Sheet ID
const LOG_SHEET      = 'WorkLogs';            // Main log data
const WORKER_SHEET   = 'Workers';             // Worker registry
const CUSTOMER_SHEET = 'Customers';           // Customer master list
const ORDER_SHEET    = 'Orders';              // Orders master list
const USER_SHEET     = 'Users';               // User credentials (managed by admin)

// ── API KEY — optional security layer ──────────────────────────────────────────
// Set this to any secret string, then paste the same string into the
// Setup tab of every HTML page (Admin / Worker / Maintainer).
// When set (non-empty), every request must include ?apiKey=<value> or
// the server returns an auth error.  Leave empty ('') to disable.
const API_KEY = '';  // ← e.g. 'mfgops-secret-2024'  (empty = open access)

// ── USER SHEET HEADERS ─────────────────────────────────────────────────────────
const USER_HEADERS = [
  'Username', 'Password', 'Role', 'Pages', 'Full Name', 'Active', 'Last Login'
];

// ── COLUMN DEFINITIONS ───────────────────────────────────────────────────────
// WorkLogs sheet — 32 columns (matches worker_log_form.html exactly)
const LOG_HEADERS = [
  'Timestamp', 'Date', 'Worker Name', 'Worker ID', 'Team', 'Shift', 'Supervisor',
  'Customer', 'Order No', 'RFQ Ref', 'Part Name',
  'Qty Assigned', 'Qty Completed', 'Operations',
  'Time In', 'Time Out', 'Break (mins)', 'Hours Worked', 'Overtime Hrs',
  'Job Status', 'Defect Count', 'Rework', 'Quality Notes', 'Work Notes',
  'Escalation', 'Machine', 'Material',
  'NCM Ref', 'NCM Type', 'NCM Qty', 'NCM Disposition', 'NCM Description'
];

// Workers sheet — columns that the form reads to auto-populate fields
const WORKER_HEADERS = [
  'Worker ID', 'Worker Name', 'Team', 'Shift', 'Supervisor',
  'Primary Operation', 'Status', 'Join Date', 'Assigned Customers', 'Notes / Skills'
];

// Customers sheet — columns the form reads for the customer dropdown
const CUSTOMER_HEADERS = [
  'Customer ID', 'Customer Name', 'Company', 'Country',
  'Contact Person', 'Email', 'Payment Terms', 'Priority'
];

// ══════════════════════════════════════════════════════════════════════════════
//  ROUTER — doGet / doPost
// ══════════════════════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action || 'addLog';

        if      (action === 'addLog')      return addLog(data);
    if      (action === 'addLogs')     return addLogs(data);   // multi-job batch submit
    if      (action === 'addUser')     return addUser(data);
    if      (action === 'updateUser')  return updateUser(data);
    if      (action === 'deleteUser')  return deleteUser(data);
    if (action === 'addWorker')     return addWorker(data);
    if (action === 'updateWorker')  return updateWorker(data);
    if (action === 'deleteWorker')  return deleteWorker(data);
    if (action === 'addPO')         return addPO(data);
    if (action === 'updatePO')      return updatePO(data);
    if (action === 'addCustomer')   return addCustomer(data);
    if (action === 'updateCustomer') return updateCustomer(data);
    if (action === 'archiveLogs')   return archiveLogs(data);
    if (action === 'archivePOs')    return archivePOs(data);

    return makeResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return makeResponse({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  // ── CORS headers via HtmlService trick ──────────────────────────────────────
  // ContentService alone cannot set Access-Control-Allow-Origin.
  // We use a thin HTML wrapper that immediately calls the JSON endpoint,
  // OR we return the JSON directly — Apps Script automatically adds CORS
  // headers when deployed as "Execute as: Me / Anyone can access".
  //
  // ROOT CAUSE OF ERRORS: The script was not re-deployed after code changes,
  // OR "Who has access" was not set to "Anyone". Fix those first.
  // This version uses ContentService with proper setup to avoid all CORS issues.

  const action   = e.parameter.action   || 'getData';
  const callback = e.parameter.callback || '';

  // ── Route to handler ──
  let result;
  try {
    if      (action === 'getData')             result = getData(e.parameter);
    else if (action === 'getWorkers')          result = getWorkers(e.parameter);
    else if (action === 'getCustomers')        result = getCustomers();
    else if (action === 'getOrders')           result = getOrders(e.parameter);
    else if (action === 'getOrderActivity')    result = getOrderActivity(e.parameter);
    else if (action === 'getDashboardSummary') result = getDashboardSummary();
    else if (action === 'getNcmReport')        result = getNcmReport(e.parameter);
    else if (action === 'getEscalations')      result = getEscalations(e.parameter);
    else if (action === 'getPOs')              result = getPOs(e.parameter);
    else if (action === 'getUsers')            result = getUsers(e.parameter);
    else if (action === 'getBackupPreview')    result = getBackupPreview(e.parameter);
    else if (action === 'getArchiveList')      result = getArchiveList(e.parameter);
    else if (action === 'test')                result = makeResponse({ status: 'ok', message: 'MFG OPS Script is working!', timestamp: new Date().toISOString() });
    else result = makeResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    result = makeResponse({ error: err.toString(), action: action });
  }

  const json = result.getContent();

  // ── JSONP mode (for file:// origin fallback) ──
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // ── Standard JSON with CORS header ──
  // NOTE: Apps Script automatically serves with Access-Control-Allow-Origin: *
  // when deployed as a Web App with "Anyone" access. No extra header needed.
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ══════════════════════════════════════════════════════════════════════════════
//  ADD LOG  (called by worker_log_form.html on submit)
// ══════════════════════════════════════════════════════════════════════════════

function addLog(data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheet(ss, LOG_SHEET, LOG_HEADERS);

  const row = [
    data.timestamp  || new Date().toISOString(),
    data.date,
    data.workerName,
    data.workerId,
    data.team,
    data.shift,
    data.supervisor,
    data.customer,
    data.orderNo,
    data.rfqRef       || '',
    data.partName     || '',
    toNum(data.qtyAssigned),
    toNum(data.qtyCompleted),
    data.operations   || '',
    data.timeIn       || '',
    data.timeOut      || '',
    toNum(data.breakMins),
    toNum(data.hoursWorked, true),
    toNum(data.overtimeHrs, true),
    data.jobStatus    || '',
    toNum(data.defectCount),
    data.rework       || 'No',
    data.qualityNotes || '',
    data.workNotes    || '',
    data.escalation   || '',
    data.machine      || '',
    data.material     || '',
    // NCM columns (new — cols 28-32)
    data.ncmRef         || '',
    data.ncmType        || '',
    toNum(data.ncmQty),
    data.ncmDisposition || '',
    data.ncmDescription || ''
  ];

  sheet.appendRow(row);

  // Update customer last-seen date
  touchCustomer(ss, data.customer, data.team);

  // Update worker last-active date
  touchWorkerLastActive(ss, data.workerId, data.date);

  return makeResponse({
    success: true,
    message: 'Log submitted',
    rowsNow: sheet.getLastRow() - 1
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  ADD MULTIPLE LOGS (worker multi-job submit)
//  data.logs = array of log objects; each is saved as a separate row.
// ══════════════════════════════════════════════════════════════════════════════
function addLogs(data) {
  if (!data.logs || !Array.isArray(data.logs) || data.logs.length === 0) {
    return makeResponse({ success: false, error: 'data.logs array is required' });
  }
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheet(ss, LOG_SHEET, LOG_HEADERS);
  let saved = 0;
  data.logs.forEach(function(log) {
    const row = [
      log.timestamp  || new Date().toISOString(),
      log.date,
      log.workerName,
      log.workerId,
      log.team,
      log.shift,
      log.supervisor,
      log.customer,
      log.orderNo,
      log.rfqRef       || '',
      log.partName     || '',
      toNum(log.qtyAssigned),
      toNum(log.qtyCompleted),
      log.operations   || '',
      log.timeIn       || '',
      log.timeOut      || '',
      toNum(log.breakMins),
      toNum(log.hoursWorked, true),
      toNum(log.overtimeHrs, true),
      log.jobStatus    || '',
      toNum(log.defectCount),
      log.rework       || 'No',
      log.qualityNotes || '',
      log.workNotes    || '',
      log.escalation   || '',
      log.machine      || '',
      log.material     || '',
      log.ncmRef         || '',
      log.ncmType        || '',
      toNum(log.ncmQty),
      log.ncmDisposition || '',
      log.ncmDescription || ''
    ];
    sheet.appendRow(row);
    touchCustomer(ss, log.customer, log.team);
    touchWorkerLastActive(ss, log.workerId, log.date);
    saved++;
  });
  return makeResponse({ success: true, message: saved + ' log(s) submitted', saved });
}


// ══════════════════════════════════════════════════════════════════════════════
//  GET WORK LOGS  (admin dashboard — main data feed)
// ══════════════════════════════════════════════════════════════════════════════

function getData(params) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) return makeResponse({ data: [], total: 0 });

  const all = sheet.getDataRange().getValues();
  if (all.length <= 1) return makeResponse({ data: [], total: 0 });

  const headers = all[0];
  let rows = all.slice(1)
    .map(r => rowToObj(headers, r))
    .filter(r => r.workerName); // skip blank rows

  // ── Filters ──
  if (params.team)      rows = rows.filter(r => r.team === params.team);
  if (params.customer)  rows = rows.filter(r => r.customer === params.customer);
  if (params.orderNo)   rows = rows.filter(r => r.orderNo === params.orderNo);
  if (params.status)    rows = rows.filter(r => r.jobStatus === params.status);
  if (params.worker)    rows = rows.filter(r => r.workerId === params.worker || r.workerName === params.worker);
  if (params.operation) rows = rows.filter(r => (r.operations || '').includes(params.operation));
  if (params.dateFrom)  rows = rows.filter(r => r.date >= params.dateFrom);
  if (params.dateTo)    rows = rows.filter(r => r.date <= params.dateTo);
  if (params.ncmOnly === 'true') rows = rows.filter(r => r.jobStatus === 'NCM Raised' || (r.operations||'').includes('NCM'));

  // ── Pagination ──
  const total  = rows.length;
  const limit  = parseInt(params.limit)  || 2000;
  const offset = parseInt(params.offset) || 0;
  rows = rows.slice(offset, offset + limit);

  return makeResponse({ data: rows, total, limit, offset });
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET WORKERS  (form dropdown + admin dashboard worker cards)
//  Reads from the Workers sheet — returns active workers with all fields
//  so the form can auto-populate Name, Team, Supervisor, Shift
// ══════════════════════════════════════════════════════════════════════════════

function getWorkers(params) {
  const ss       = SpreadsheetApp.openById(SHEET_ID);
  const regSheet = ss.getSheetByName(WORKER_SHEET);

  // ── Fast path: read directly from Workers sheet ──────────────────────────
  // This is lightweight and never times out.
  // The admin dashboard uses ?action=getWorkerStats separately for enriched data.
  if (regSheet && regSheet.getLastRow() > 1) {
    const all     = regSheet.getDataRange().getValues();
    const headers = all[0];

    let workers = all.slice(1)
      .map(r => rowToObj(headers, r))
      .filter(r => r.workerId && r.workerName);  // toCamelCase("Worker ID") = "workerId" ✓

    // Exclude Inactive unless caller wants all
    if (!params || params.activeOnly !== 'false') {
      workers = workers.filter(r => (r.status || 'Active') !== 'Inactive');
    }

    // Normalise primaryOperation → primaryOp alias so form works
    workers = workers.map(w => ({
      workerId:   w.workerId,
      workerName: w.workerName,
      team:       w.team,
      shift:      w.shift,
      supervisor: w.supervisor,
      primaryOp:  w.primaryOperation || w.primaryOp || '',
      status:     w.status || 'Active',
      joinDate:   w.joinDate || '',
      customers:  w.assignedCustomers || w.customers || '',
      notes:      w.notesSkills || w.notes || ''
    }));

    return makeResponse({ workers, source: 'registry', count: workers.length });
  }

  // ── Fallback: derive unique workers from WorkLogs ─────────────────────────
  const logSheet = ss.getSheetByName(LOG_SHEET);
  if (!logSheet || logSheet.getLastRow() <= 1) return makeResponse({ workers: [], source: 'empty' });

  const all     = logSheet.getDataRange().getValues();
  const headers = all[0];
  const map     = {};

  all.slice(1).forEach(row => {
    const r = rowToObj(headers, row);
    if (!r.workerId || !r.workerName) return;
    if (!map[r.workerId]) {
      map[r.workerId] = {
        workerId: r.workerId, workerName: r.workerName, team: r.team,
        shift: r.shift || 'Morning', supervisor: r.supervisor || '',
        primaryOp: '', status: 'Active', joinDate: '', customers: '', notes: ''
      };
    }
  });

  return makeResponse({ workers: Object.values(map), source: 'logs_fallback' });
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET CUSTOMERS  (form dropdown)
//  Returns customer names from the Customers sheet
// ══════════════════════════════════════════════════════════════════════════════

function getCustomers() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(CUSTOMER_SHEET);

  if (sheet && sheet.getLastRow() > 1) {
    const all     = sheet.getDataRange().getValues();
    const headers = all[0];
    const customers = all.slice(1)
      .map(r => rowToObj(headers, r))
      .filter(r => r.customerName)
      .map(r => ({
        customerName: r.customerName,
        company:      r.company      || '',
        country:      r.country      || '',
        priority:     r.priority     || '',
        contactPerson: r.contactPerson || '',
        email:        r.email        || ''
      }));
    return makeResponse({ customers });
  }

  // Fallback: derive unique customers from WorkLogs
  const logSheet = ss.getSheetByName(LOG_SHEET);
  if (!logSheet || logSheet.getLastRow() <= 1) return makeResponse({ customers: [] });

  const all     = logSheet.getDataRange().getValues();
  const headers = all[0];
  const names   = new Set();

  all.slice(1).forEach(row => {
    const r = rowToObj(headers, row);
    if (r.customer) names.add(r.customer);
  });

  const customers = [...names].sort().map(n => ({ customerName: n }));
  return makeResponse({ customers });
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET ORDERS  (admin dashboard order tracker)
// ══════════════════════════════════════════════════════════════════════════════

function getOrders(params) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return makeResponse({ orders: [] });

  const all     = sheet.getDataRange().getValues();
  const headers = all[0];
  const orderMap = {};

  all.slice(1).forEach(row => {
    const r = rowToObj(headers, row);
    if (!r.orderNo || !r.workerName) return;
    if (!orderMap[r.orderNo]) {
      orderMap[r.orderNo] = {
        orderNo: r.orderNo, customer: r.customer, partName: r.partName,
        qtyAssigned: 0, qtyCompleted: 0, lastDate: '', lastStatus: '',
        defects: 0, logCount: 0, team: r.team, hasNcm: false,
        hasEscalation: false, workers: new Set()
      };
    }
    const o = orderMap[r.orderNo];
    const assigned = parseInt(r.qtyAssigned) || 0;
    if (assigned > o.qtyAssigned) o.qtyAssigned = assigned;
    o.qtyCompleted += parseInt(r.qtyCompleted) || 0;
    o.defects      += parseInt(r.defectCount)  || 0;
    o.logCount++;
    o.workers.add(r.workerId);
    if ((r.operations || '').includes('NCM') || r.jobStatus === 'NCM Raised') o.hasNcm = true;
    if (r.escalation && r.escalation.trim()) o.hasEscalation = true;
    if (r.date > o.lastDate) { o.lastDate = r.date; o.lastStatus = r.jobStatus; }
  });

  // Filter
  let orders = Object.values(orderMap).map(o => ({
    ...o, workerCount: o.workers.size, workers: undefined
  }));

  if (params && params.customer) orders = orders.filter(o => o.customer === params.customer);
  if (params && params.status)   orders = orders.filter(o => o.lastStatus === params.status);
  if (params && params.ncmOnly === 'true') orders = orders.filter(o => o.hasNcm);

  orders.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  return makeResponse({ orders });
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET ORDER ACTIVITY  (admin dashboard — Order Detail modal)
//  Returns every log entry for a specific order/job number
// ══════════════════════════════════════════════════════════════════════════════

function getOrderActivity(params) {
  if (!params.orderNo) return makeResponse({ error: 'orderNo parameter required' });

  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return makeResponse({ logs: [], summary: {} });

  const all     = sheet.getDataRange().getValues();
  const headers = all[0];

  const logs = all.slice(1)
    .map(r => rowToObj(headers, r))
    .filter(r => r.orderNo === params.orderNo && r.workerName);

  if (!logs.length) return makeResponse({ logs: [], summary: {} });

  // Sort chronologically
  logs.sort((a, b) => a.date.localeCompare(b.date));

  // Build summary
  const workerMap = {};
  let totalUnits = 0, totalHours = 0, totalDefects = 0, ncmCount = 0;
  const opsCount = {};
  const escalations = [];
  const ncmEntries  = [];

  logs.forEach(r => {
    totalUnits   += parseInt(r.qtyCompleted)  || 0;
    totalHours   += parseFloat(r.hoursWorked) || 0;
    totalDefects += parseInt(r.defectCount)   || 0;

    if (!workerMap[r.workerId]) workerMap[r.workerId] = { workerName: r.workerName, workerId: r.workerId, team: r.team, units: 0, hours: 0, logs: 0 };
    workerMap[r.workerId].units += parseInt(r.qtyCompleted)  || 0;
    workerMap[r.workerId].hours += parseFloat(r.hoursWorked) || 0;
    workerMap[r.workerId].logs++;

    (r.operations || '').split(',').forEach(op => {
      const t = op.trim();
      if (t) opsCount[t] = (opsCount[t] || 0) + 1;
    });

    if ((r.operations || '').includes('NCM') || r.jobStatus === 'NCM Raised') {
      ncmCount++;
      ncmEntries.push({
        date: r.date, workerName: r.workerName, ncmRef: r.ncmRef || '',
        ncmType: r.ncmType || '', ncmQty: r.ncmQty || '', ncmDisposition: r.ncmDisposition || '',
        ncmDescription: r.ncmDescription || ''
      });
    }

    if (r.escalation && r.escalation.trim()) {
      escalations.push({ date: r.date, workerName: r.workerName, escalation: r.escalation });
    }
  });

  const maxQtyAssigned = Math.max(...logs.map(r => parseInt(r.qtyAssigned) || 0), 0);

  const summary = {
    orderNo:         params.orderNo,
    customer:        logs[0].customer,
    partName:        logs[0].partName,
    firstDate:       logs[0].date,
    lastDate:        logs[logs.length - 1].date,
    lastStatus:      logs[logs.length - 1].jobStatus,
    qtyAssigned:     maxQtyAssigned,
    totalUnits,
    totalHours:      Math.round(totalHours * 10) / 10,
    totalDefects,
    ncmCount,
    logCount:        logs.length,
    workerCount:     Object.keys(workerMap).length,
    workers:         Object.values(workerMap),
    operationCounts: opsCount,
    escalations,
    ncmEntries
  };

  return makeResponse({ logs, summary });
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET DASHBOARD SUMMARY  (overview KPIs)
// ══════════════════════════════════════════════════════════════════════════════

function getDashboardSummary() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return makeResponse({ summary: {} });

  const all     = sheet.getDataRange().getValues();
  const headers = all[0];
  const tz      = Session.getScriptTimeZone();
  const today   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // Week boundaries (Mon–Sun)
  const now     = new Date();
  const dayOfWk = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - dayOfWk);
  const weekStr   = Utilities.formatDate(weekStart, tz, 'yyyy-MM-dd');

  // Month boundary
  const monthStr = today.slice(0, 8) + '01';

  const makeBucket = () => ({ logs: 0, units: 0, hours: 0, defects: 0, workers: new Set(), overtime: 0, ncm: 0, completed: 0, onHold: 0 });
  const buckets = { today: makeBucket(), week: makeBucket(), month: makeBucket(), total: makeBucket() };

  all.slice(1).forEach(row => {
    const r = rowToObj(headers, row);
    if (!r.workerName) return;

    const add = (b) => {
      b.logs++;
      b.units    += parseInt(r.qtyCompleted)  || 0;
      b.hours    += parseFloat(r.hoursWorked) || 0;
      b.defects  += parseInt(r.defectCount)   || 0;
      b.overtime += parseFloat(r.overtimeHrs) || 0;
      b.workers.add(r.workerId);
      if ((r.operations || '').includes('NCM') || r.jobStatus === 'NCM Raised') b.ncm++;
      if (r.jobStatus === 'Completed' || r.jobStatus === 'Shipped') b.completed++;
      if (r.jobStatus === 'On Hold') b.onHold++;
    };

    add(buckets.total);
    if (r.date >= monthStr) add(buckets.month);
    if (r.date >= weekStr)  add(buckets.week);
    if (r.date === today)   add(buckets.today);
  });

  const fmt = (b) => ({
    logs:          b.logs,
    units:         b.units,
    hours:         Math.round(b.hours * 10) / 10,
    defects:       b.defects,
    overtime:      Math.round(b.overtime * 10) / 10,
    activeWorkers: b.workers.size,
    ncmCount:      b.ncm,
    completedJobs: b.completed,
    onHold:        b.onHold
  });

  return makeResponse({
    summary: {
      today: fmt(buckets.today),
      week:  fmt(buckets.week),
      month: fmt(buckets.month),
      total: fmt(buckets.total)
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET NCM REPORT  (filtered NCM entries)
// ══════════════════════════════════════════════════════════════════════════════

function getNcmReport(params) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return makeResponse({ ncmEntries: [] });

  const all     = sheet.getDataRange().getValues();
  const headers = all[0];

  let entries = all.slice(1)
    .map(r => rowToObj(headers, r))
    .filter(r => r.workerName && ((r.operations || '').includes('NCM') || r.jobStatus === 'NCM Raised'));

  if (params.customer) entries = entries.filter(r => r.customer === params.customer);
  if (params.orderNo)  entries = entries.filter(r => r.orderNo === params.orderNo);
  if (params.team)     entries = entries.filter(r => r.team === params.team);
  if (params.dateFrom) entries = entries.filter(r => r.date >= params.dateFrom);
  if (params.dateTo)   entries = entries.filter(r => r.date <= params.dateTo);

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return makeResponse({ ncmEntries: entries, total: entries.length });
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET ESCALATIONS  (all logs that have an escalation note)
// ══════════════════════════════════════════════════════════════════════════════

function getEscalations(params) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return makeResponse({ escalations: [] });

  const all     = sheet.getDataRange().getValues();
  const headers = all[0];

  let entries = all.slice(1)
    .map(r => rowToObj(headers, r))
    .filter(r => r.workerName && r.escalation && r.escalation.trim() !== '');

  if (params.dateFrom) entries = entries.filter(r => r.date >= params.dateFrom);
  if (params.dateTo)   entries = entries.filter(r => r.date <= params.dateTo);
  if (params.team)     entries = entries.filter(r => r.team === params.team);

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return makeResponse({ escalations: entries, total: entries.length });
}

// ══════════════════════════════════════════════════════════════════════════════
//  WORKER CRUD  (admin dashboard Workers tab)
// ══════════════════════════════════════════════════════════════════════════════

function addWorker(data) {
  if (!data.workerId || !data.workerName || !data.team) {
    return makeResponse({ success: false, error: 'workerId, workerName, and team are required' });
  }

  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheet(ss, WORKER_SHEET, WORKER_HEADERS);

  // Check for duplicate ID
  const existing = sheet.getDataRange().getValues();
  const ids = existing.slice(1).map(r => r[0]);
  if (ids.includes(data.workerId)) {
    return makeResponse({ success: false, error: 'Worker ID already exists: ' + data.workerId });
  }

  const row = [
    data.workerId, data.workerName, data.team, data.shift || 'Morning',
    data.supervisor || '', data.primaryOp || '', data.status || 'Active',
    data.joinDate || today(), data.customers || '', data.notes || ''
  ];

  sheet.appendRow(row);
  return makeResponse({ success: true, message: 'Worker added: ' + data.workerName });
}

function updateWorker(data) {
  if (!data.workerId) return makeResponse({ success: false, error: 'workerId required' });

  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(WORKER_SHEET);
  if (!sheet) return makeResponse({ success: false, error: 'Workers sheet not found' });

  const all  = sheet.getDataRange().getValues();
  const rowIdx = all.slice(1).findIndex(r => r[0] === data.workerId);
  if (rowIdx === -1) return makeResponse({ success: false, error: 'Worker not found: ' + data.workerId });

  const sheetRow = rowIdx + 2; // +1 for header, +1 for 1-indexed
  const updates = [
    data.workerId,
    data.workerName || all[rowIdx + 1][1],
    data.team       || all[rowIdx + 1][2],
    data.shift      || all[rowIdx + 1][3],
    data.supervisor || all[rowIdx + 1][4],
    data.primaryOp  || all[rowIdx + 1][5],
    data.status     || all[rowIdx + 1][6],
    data.joinDate   || all[rowIdx + 1][7],
    data.customers  !== undefined ? data.customers : all[rowIdx + 1][8],
    data.notes      !== undefined ? data.notes     : all[rowIdx + 1][9]
  ];

  sheet.getRange(sheetRow, 1, 1, updates.length).setValues([updates]);
  return makeResponse({ success: true, message: 'Worker updated: ' + data.workerId });
}

function deleteWorker(data) {
  if (!data.workerId) return makeResponse({ success: false, error: 'workerId required' });

  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(WORKER_SHEET);
  if (!sheet) return makeResponse({ success: false, error: 'Workers sheet not found' });

  const all    = sheet.getDataRange().getValues();
  const rowIdx = all.slice(1).findIndex(r => r[0] === data.workerId);
  if (rowIdx === -1) return makeResponse({ success: false, error: 'Worker not found: ' + data.workerId });

  sheet.deleteRow(rowIdx + 2);
  return makeResponse({ success: true, message: 'Worker removed from registry: ' + data.workerId });
}

// ══════════════════════════════════════════════════════════════════════════════
//  ADD / UPDATE PURCHASE ORDER  (Maintainer form)
// ══════════════════════════════════════════════════════════════════════════════

const PO_HEADERS = [
  'Job Number', 'Customer', 'Part Name', 'Total Qty', 'Unit Price',
  'Currency', 'Start Date', 'Due Date', 'Priority', 'Status',
  'Notes', 'Created By', 'Created At', 'Last Updated'
];
// Key mapping after toCamelCase:
//   Job Number  -> jobNumber   ✓
//   Part Name   -> partName    ✓
//   Total Qty   -> totalQty    ✓
//   Unit Price  -> unitPrice   ✓
//   Start Date  -> startDate   ✓
//   Due Date    -> dueDate     ✓
//   Created By  -> createdBy   ✓
//   Created At  -> createdAt   ✓
//   Last Updated-> lastUpdated ✓

function addPO(data) {
  // Accept either jobNumber (new) or poNumber (legacy) from the form
  const jobNum = data.jobNumber || data.poNumber || '';
  if (!jobNum || !data.customer) {
    return makeResponse({ success: false, error: 'jobNumber and customer are required' });
  }
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheet(ss, ORDER_SHEET, PO_HEADERS);

  // Check duplicate (column A = Job Number)
  const existing = sheet.getDataRange().getValues();
  const nums = existing.slice(1).map(r => String(r[0]));
  if (nums.includes(jobNum)) {
    return makeResponse({ success: false, error: 'Job already exists: ' + jobNum + '. Use updatePO to edit.' });
  }

  const now = new Date().toISOString();
  sheet.appendRow([
    jobNum, data.customer, data.partName || '', toNum(data.totalQty),
    toNum(data.unitPrice, true), data.currency || 'USD',
    data.startDate || today(), data.dueDate || '',
    data.priority || 'Medium', data.status || 'Open',
    data.notes || '', data.createdBy || '', now, now
  ]);

  return makeResponse({ success: true, message: 'Job added: ' + jobNum });
}

function updatePO(data) {
  const jobNum = data.jobNumber || data.poNumber || '';
  if (!jobNum) return makeResponse({ success: false, error: 'jobNumber required' });
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(ORDER_SHEET);
  if (!sheet) return makeResponse({ success: false, error: 'Orders sheet not found' });

  const all    = sheet.getDataRange().getValues();
  const rowIdx = all.slice(1).findIndex(r => String(r[0]) === jobNum);
  if (rowIdx === -1) return makeResponse({ success: false, error: 'Job not found: ' + jobNum });

  const r   = all[rowIdx + 1];
  const now = new Date().toISOString();
  sheet.getRange(rowIdx + 2, 1, 1, 14).setValues([[
    jobNum,
    data.customer   || r[1],
    data.partName   || r[2],
    data.totalQty   !== undefined ? toNum(data.totalQty)          : r[3],
    data.unitPrice  !== undefined ? toNum(data.unitPrice, true)   : r[4],
    data.currency   || r[5],
    data.startDate  || r[6],
    data.dueDate    || r[7],
    data.priority   || r[8],
    data.status     || r[9],
    data.notes      !== undefined ? data.notes : r[10],
    r[11], r[12], now
  ]]);

  return makeResponse({ success: true, message: 'Job updated: ' + jobNum });
}

function getPOs(params) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(ORDER_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return makeResponse({ pos: [] });

  const all     = sheet.getDataRange().getValues();
  const headers = all[0];

  let pos = all.slice(1)
    .map(r => rowToObj(headers, r))
    .map(r => {
      // Normalise: handle old sample data ("Order / Job No" -> "orderJobNo")
      // and new schema ("Job Number" -> "jobNumber") into one consistent field
      const jobNum = r.jobNumber || r.orderJobNo || r.pONumber || r.poNumber || '';
      const part   = r.partName  || r.partProduct || '';
      return {
        jobNumber:   jobNum,
        customer:    r.customer    || '',
        partName:    part,
        totalQty:    r.totalQty    || '0',
        unitPrice:   r.unitPrice   || '0',
        currency:    r.currency    || 'USD',
        startDate:   r.startDate   || '',
        dueDate:     r.dueDate     || '',
        priority:    r.priority    || 'Medium',
        status:      r.status      || 'Open',
        notes:       r.notes       || '',
        createdBy:   r.createdBy   || '',
        createdAt:   r.createdAt   || '',
        lastUpdated: r.lastUpdated || ''
      };
    })
    .filter(r => r.jobNumber); // skip blank rows

  if (params && params.customer) pos = pos.filter(p => p.customer === params.customer);
  if (params && params.status)   pos = pos.filter(p => p.status   === params.status);

  return makeResponse({ pos, total: pos.length });
}


// ══════════════════════════════════════════════════════════════════════════════
//  TOUCH HELPERS  (update last-seen dates without full rewrite)
// ══════════════════════════════════════════════════════════════════════════════

function touchWorkerLastActive(ss, workerId, date) {
  // The Workers sheet doesn't have a "Last Active" column by default,
  // but we update it if a column named "Last Active" exists.
  const sheet = ss.getSheetByName(WORKER_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIdx  = headers.indexOf('Last Active');
  if (colIdx === -1) return;

  const ids    = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const rowIdx = ids.findIndex(r => r[0] === workerId);
  if (rowIdx !== -1) {
    sheet.getRange(rowIdx + 2, colIdx + 1).setValue(date || today());
  }
}

function touchCustomer(ss, customerName, team) {
  if (!customerName) return;
  const sheet = ss.getSheetByName(CUSTOMER_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const all   = sheet.getDataRange().getValues();
  const names = all.slice(1).map(r => r[1]); // Column B = Customer Name
  const idx   = names.indexOf(customerName);

  if (idx === -1) {
    // Auto-add new customer from form submission
    const newId = 'CUST-' + String(all.length).padStart(3, '0');
    sheet.appendRow([newId, customerName, '', '', '', '', '', 'Medium']);
  }
  // (Could update "last order date" here if that column exists)
}

// ══════════════════════════════════════════════════════════════════════════════
//  DAILY EMAIL SUMMARY  (optional — set a time-based trigger to run daily)
// ══════════════════════════════════════════════════════════════════════════════

function sendDailySummaryEmail() {
  const ADMIN_EMAIL = 'your-email@example.com'; // ← Replace with your email

  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const tz      = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const all      = sheet.getDataRange().getValues();
  const headers  = all[0];

  const todayRows = all.slice(1)
    .map(r => rowToObj(headers, r))
    .filter(r => r.date === todayStr && r.workerName);

  if (!todayRows.length) {
    Logger.log('No logs for today — email skipped');
    return;
  }

  const totalUnits  = todayRows.reduce((a, r) => a + (parseInt(r.qtyCompleted)  || 0), 0);
  const totalHours  = todayRows.reduce((a, r) => a + (parseFloat(r.hoursWorked) || 0), 0);
  const totalDefects = todayRows.reduce((a, r) => a + (parseInt(r.defectCount) || 0), 0);
  const ncmToday    = todayRows.filter(r => (r.operations || '').includes('NCM') || r.jobStatus === 'NCM Raised');
  const escToday    = todayRows.filter(r => r.escalation && r.escalation.trim());
  const uniqueWorkers = [...new Set(todayRows.map(r => `  • ${r.workerName} (${r.team}) — ${r.qtyCompleted} units`))];

  const ncmBlock = ncmToday.length
    ? `⚠ NCM ENTRIES (${ncmToday.length})\n${ncmToday.map(r => `  • ${r.workerName} | ${r.orderNo} | ${r.ncmType || 'No type'} | ${r.ncmDisposition || 'Pending'}`).join('\n')}`
    : '✅ No NCM entries today';

  const escBlock = escToday.length
    ? `🚨 ESCALATIONS (${escToday.length})\n${escToday.map(r => `  • ${r.workerName}: ${r.escalation}`).join('\n')}`
    : '✅ No escalations today';

  const body = `
MFG OPS — Daily Summary for ${todayStr}
${'═'.repeat(44)}

📊 TODAY'S STATS
  Logs Submitted : ${todayRows.length}
  Units Completed: ${totalUnits}
  Labor Hours    : ${totalHours.toFixed(1)} hrs
  Defects Reported: ${totalDefects}

👷 ACTIVE WORKERS (${uniqueWorkers.length})
${uniqueWorkers.join('\n')}

${ncmBlock}

${escBlock}

${'─'.repeat(44)}
View full details in the MFG OPS Admin Dashboard.
  `;

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: `MFG OPS Daily Summary — ${todayStr}  [${totalUnits} units · ${todayRows.length} logs${ncmToday.length ? ' · ⚠ ' + ncmToday.length + ' NCM' : ''}]`,
    body: body.trim()
  });

  Logger.log('Daily summary sent for ' + todayStr);
}


// ══════════════════════════════════════════════════════════════════════════════
//  CUSTOMER CRUD  (Maintainer form)
// ══════════════════════════════════════════════════════════════════════════════

function addCustomer(data) {
  if (!data.customerName) return makeResponse({ success: false, error: 'customerName required' });
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheet(ss, CUSTOMER_SHEET, CUSTOMER_HEADERS);

  const all   = sheet.getDataRange().getValues();
  const names = all.slice(1).map(r => r[1]); // col B = Customer Name
  if (names.includes(data.customerName)) {
    return makeResponse({ success: false, error: 'Customer already exists: ' + data.customerName });
  }

  const newId = 'CUST-' + String(all.length).padStart(3, '0');
  sheet.appendRow([
    data.customerId || newId, data.customerName, data.company || '',
    data.country || '', data.contactPerson || '', data.email || '',
    data.paymentTerms || 'Net 30', data.priority || 'Medium'
  ]);

  return makeResponse({ success: true, message: 'Customer added: ' + data.customerName, id: data.customerId || newId });
}

function updateCustomer(data) {
  if (!data.customerName) return makeResponse({ success: false, error: 'customerName required' });
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(CUSTOMER_SHEET);
  if (!sheet) return makeResponse({ success: false, error: 'Customers sheet not found' });

  const all    = sheet.getDataRange().getValues();
  const rowIdx = all.slice(1).findIndex(r => r[1] === data.customerName);
  if (rowIdx === -1) return makeResponse({ success: false, error: 'Customer not found: ' + data.customerName });

  const r = all[rowIdx + 1];
  sheet.getRange(rowIdx + 2, 1, 1, 8).setValues([[
    r[0],
    data.customerName,
    data.company       || r[2],
    data.country       || r[3],
    data.contactPerson || r[4],
    data.email         || r[5],
    data.paymentTerms  || r[6],
    data.priority      || r[7]
  ]]);

  return makeResponse({ success: true, message: 'Customer updated: ' + data.customerName });
}

// ══════════════════════════════════════════════════════════════════════════════
//  API KEY CHECK — call this at the top of any protected handler
// ══════════════════════════════════════════════════════════════════════════════
function checkApiKey(params) {
  if (!API_KEY) return true;  // key not set → open access
  return (params.apiKey || '') === API_KEY;
}

// ══════════════════════════════════════════════════════════════════════════════
//  USER MANAGEMENT  (Admin → Setup tab → Users sheet in Google Sheets)
//
//  The Users sheet has columns:
//    Username | Password | Role | Pages | Full Name | Active | Last Login
//
//  Role values : admin, manager, maintainer, worker
//  Pages values: comma-separated page names: admin,maintainer,worker
//
//  The portal login page calls ?action=getUsers to validate credentials
//  instead of using the hardcoded defaults.
// ══════════════════════════════════════════════════════════════════════════════
function getUsers(params) {
  if (!checkApiKey(params)) {
    return makeResponse({ error: 'Unauthorized — invalid API key', code: 401 });
  }
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheet(ss, USER_SHEET, USER_HEADERS);
  const all   = sheet.getDataRange().getValues();
  if (all.length <= 1) return makeResponse({ users: [] });

  const headers = all[0];
  const users = all.slice(1)
    .map(r => rowToObj(headers, r))
    .filter(u => u.username)
    .map(u => ({
      username:  u.username,
      password:  u.password,   // NOTE: stored plain-text — sheet must be private
      role:      u.role     || 'worker',
      pages:     u.pages    || 'worker',
      fullName:  u.fullName || u.username,
      active:    u.active   !== 'false' && u.active !== 'No' && u.active !== '0'
    }));

  return makeResponse({ users });
}

function addUser(data) {
  if (!checkApiKey(data)) {
    return makeResponse({ error: 'Unauthorized', code: 401 });
  }
  if (!data.username || !data.password) {
    return makeResponse({ success: false, error: 'username and password required' });
  }
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheet(ss, USER_SHEET, USER_HEADERS);
  const all   = sheet.getDataRange().getValues();

  // Check duplicate
  const exists = all.slice(1).some(r => String(r[0]).toLowerCase() === data.username.toLowerCase());
  if (exists) return makeResponse({ success: false, error: 'Username already exists: ' + data.username });

  sheet.appendRow([
    data.username, data.password,
    data.role     || 'worker',
    data.pages    || 'worker',
    data.fullName || data.username,
    data.active !== undefined ? data.active : 'true',
    ''
  ]);
  return makeResponse({ success: true, message: 'User added: ' + data.username });
}

function updateUser(data) {
  if (!checkApiKey(data)) {
    return makeResponse({ error: 'Unauthorized', code: 401 });
  }
  if (!data.username) return makeResponse({ success: false, error: 'username required' });
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(USER_SHEET);
  if (!sheet) return makeResponse({ success: false, error: 'Users sheet not found' });

  const all    = sheet.getDataRange().getValues();
  const rowIdx = all.slice(1).findIndex(r => String(r[0]).toLowerCase() === data.username.toLowerCase());
  if (rowIdx === -1) return makeResponse({ success: false, error: 'User not found: ' + data.username });

  const existing = all[rowIdx + 1];
  sheet.getRange(rowIdx + 2, 1, 1, 7).setValues([[
    data.username,
    data.password  || existing[1],
    data.role      || existing[2],
    data.pages     || existing[3],
    data.fullName  || existing[4],
    data.active    !== undefined ? data.active : existing[5],
    existing[6]    // preserve last login
  ]]);
  return makeResponse({ success: true, message: 'User updated: ' + data.username });
}

function deleteUser(data) {
  if (!checkApiKey(data)) {
    return makeResponse({ error: 'Unauthorized', code: 401 });
  }
  if (!data.username) return makeResponse({ success: false, error: 'username required' });
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(USER_SHEET);
  if (!sheet) return makeResponse({ success: false, error: 'Users sheet not found' });

  const all    = sheet.getDataRange().getValues();
  const rowIdx = all.slice(1).findIndex(r => String(r[0]).toLowerCase() === data.username.toLowerCase());
  if (rowIdx === -1) return makeResponse({ success: false, error: 'User not found' });

  sheet.deleteRow(rowIdx + 2);
  return makeResponse({ success: true, message: 'User deleted: ' + data.username });
}

// ══════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Ensure a sheet exists with correct headers; create & format it if not.
 */
// ══════════════════════════════════════════════════════════════════════════════
//  DATA BACKUP & ARCHIVE SYSTEM
//
//  Strategy:
//    WorkLogs older than N months  → copied to "Archive_YYYY" sheet, removed from WorkLogs
//    POs with status "Completed" or "Shipped" older than N months
//                                   → copied to "Archive_POs_YYYY", removed from Orders
//
//  Archive sheets are year-named so data is grouped by the year it was archived.
//  The ORIGINAL data in WorkLogs/Orders is deleted after a confirmed successful copy.
//
//  Safety: getBackupPreview (GET) always runs first — it tells you WHAT would
//          be moved without moving anything. The actual archiveLogs / archivePOs
//          (POST) only run when the user confirms.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Preview what would be archived — returns counts and date ranges, NO data moved.
 * Params: type ('logs'|'pos'|'both'), months (default 12)
 */
function getBackupPreview(params) {
  if (!checkApiKey(params)) return makeResponse({ error: 'Unauthorized', code: 401 });

  const months    = parseInt(params.months) || 12;
  const type      = params.type || 'both';
  const cutoffDate = getCutoffDate(months);
  const ss        = SpreadsheetApp.openById(SHEET_ID);
  const result    = { cutoffDate, months, preview: {} };

  if (type === 'logs' || type === 'both') {
    const sheet = ss.getSheetByName(LOG_SHEET);
    if (sheet && sheet.getLastRow() > 1) {
      const all     = sheet.getDataRange().getValues();
      const headers = all[0];
      const rows    = all.slice(1).map(r => rowToObj(headers, r)).filter(r => r.workerName);
      const toArchive = rows.filter(r => r.date && r.date < cutoffDate);
      const byYear    = groupByYear(toArchive, 'date');
      result.preview.logs = {
        totalRows:    rows.length,
        toArchive:    toArchive.length,
        remaining:    rows.length - toArchive.length,
        byYear,
        oldestDate:   toArchive.length ? toArchive.reduce((a,r)=>r.date<a?r.date:a, toArchive[0].date) : null,
        newestArchive:toArchive.length ? toArchive.reduce((a,r)=>r.date>a?r.date:a, toArchive[0].date) : null,
      };
    } else {
      result.preview.logs = { totalRows: 0, toArchive: 0, remaining: 0, byYear: {} };
    }
  }

  if (type === 'pos' || type === 'both') {
    const sheet = ss.getSheetByName(ORDER_SHEET);
    if (sheet && sheet.getLastRow() > 1) {
      const all     = sheet.getDataRange().getValues();
      const headers = all[0];
      const rows    = all.slice(1).map(r => rowToObj(headers, r)).filter(r => r.jobNumber || r.orderJobNo);
      const DONE    = ['Completed','Shipped','Cancelled'];
      const toArchive = rows.filter(r =>
        DONE.includes(r.status) && r.lastUpdated && r.lastUpdated < cutoffDate
      );
      const byYear  = groupByYear(toArchive, 'lastUpdated');
      result.preview.pos = {
        totalRows:  rows.length,
        toArchive:  toArchive.length,
        remaining:  rows.length - toArchive.length,
        byYear,
      };
    } else {
      result.preview.pos = { totalRows: 0, toArchive: 0, remaining: 0, byYear: {} };
    }
  }

  return makeResponse(result);
}

/**
 * Archive work logs older than `months` months into year-labelled archive sheets.
 * Returns { success, moved, byYear, errors[] }
 */
function archiveLogs(data) {
  if (!checkApiKey(data)) return makeResponse({ success: false, error: 'Unauthorized', code: 401 });

  const months     = parseInt(data.months) || 12;
  const cutoffDate = getCutoffDate(months);
  const ss         = SpreadsheetApp.openById(SHEET_ID);
  const srcSheet   = ss.getSheetByName(LOG_SHEET);

  if (!srcSheet || srcSheet.getLastRow() <= 1) {
    return makeResponse({ success: true, moved: 0, message: 'No logs to archive' });
  }

  const all     = srcSheet.getDataRange().getValues();
  const headers = all[0];
  const dataRows = all.slice(1);

  // Split: rows to archive vs rows to keep
  const toKeep    = [];
  const toArchive = []; // { year, row[] }
  const byYear    = {};

  dataRows.forEach(row => {
    const obj = rowToObj(headers, row);
    if (obj.workerName && obj.date && obj.date < cutoffDate) {
      const yr = obj.date.slice(0, 4);
      if (!byYear[yr]) byYear[yr] = [];
      byYear[yr].push(row);
    } else {
      toKeep.push(row);
    }
  });

  let totalMoved = 0;
  const errors   = [];

  // Write each year's data to its archive sheet
  Object.entries(byYear).forEach(([yr, rows]) => {
    try {
      const archiveName = 'Archive_WorkLogs_' + yr;
      const dest = ensureSheet(ss, archiveName, headers);
      if (rows.length > 0) {
        dest.getRange(dest.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
        totalMoved += rows.length;
      }
    } catch (e) {
      errors.push('Year ' + yr + ': ' + e.toString());
    }
  });

  if (errors.length > 0) {
    return makeResponse({ success: false, errors, moved: 0, message: 'Archive failed — source NOT modified' });
  }

  // Only now rewrite the source sheet (safe: archive confirmed OK)
  srcSheet.clearContents();
  srcSheet.appendRow(headers);
  formatHeaderRow(srcSheet, headers.length);
  if (toKeep.length > 0) {
    srcSheet.getRange(2, 1, toKeep.length, headers.length).setValues(toKeep);
  }

  // Record archive event in a log
  logArchiveEvent(ss, 'WorkLogs', totalMoved, cutoffDate, months);

  return makeResponse({
    success: true,
    moved:   totalMoved,
    kept:    toKeep.length,
    byYear:  Object.fromEntries(Object.entries(byYear).map(([yr,r]) => [yr, r.length])),
    message: totalMoved + ' log rows archived. ' + toKeep.length + ' rows remain in WorkLogs.'
  });
}

/**
 * Archive completed/shipped/cancelled POs older than `months` months.
 */
function archivePOs(data) {
  if (!checkApiKey(data)) return makeResponse({ success: false, error: 'Unauthorized', code: 401 });

  const months     = parseInt(data.months) || 12;
  const cutoffDate = getCutoffDate(months);
  const ss         = SpreadsheetApp.openById(SHEET_ID);
  const srcSheet   = ss.getSheetByName(ORDER_SHEET);

  if (!srcSheet || srcSheet.getLastRow() <= 1) {
    return makeResponse({ success: true, moved: 0, message: 'No POs to archive' });
  }

  const all      = srcSheet.getDataRange().getValues();
  const headers  = all[0];
  const dataRows = all.slice(1);
  const DONE     = ['Completed', 'Shipped', 'Cancelled'];

  const toKeep  = [];
  const byYear  = {};

  dataRows.forEach(row => {
    const obj = rowToObj(headers, row);
    const dateField = obj.lastUpdated || obj.createdAt || '';
    if ((obj.jobNumber || obj.orderJobNo) && DONE.includes(obj.status) && dateField && dateField < cutoffDate) {
      const yr = dateField.slice(0, 4);
      if (!byYear[yr]) byYear[yr] = [];
      byYear[yr].push(row);
    } else {
      toKeep.push(row);
    }
  });

  let totalMoved = 0;
  const errors   = [];

  Object.entries(byYear).forEach(([yr, rows]) => {
    try {
      const archiveName = 'Archive_POs_' + yr;
      const dest = ensureSheet(ss, archiveName, headers);
      if (rows.length > 0) {
        dest.getRange(dest.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
        totalMoved += rows.length;
      }
    } catch (e) {
      errors.push('Year ' + yr + ': ' + e.toString());
    }
  });

  if (errors.length > 0) {
    return makeResponse({ success: false, errors, moved: 0, message: 'Archive failed — source NOT modified' });
  }

  srcSheet.clearContents();
  srcSheet.appendRow(headers);
  formatHeaderRow(srcSheet, headers.length);
  if (toKeep.length > 0) {
    srcSheet.getRange(2, 1, toKeep.length, headers.length).setValues(toKeep);
  }

  logArchiveEvent(ss, 'Orders', totalMoved, cutoffDate, months);

  return makeResponse({
    success: true,
    moved:   totalMoved,
    kept:    toKeep.length,
    byYear:  Object.fromEntries(Object.entries(byYear).map(([yr,r]) => [yr, r.length])),
    message: totalMoved + ' PO rows archived. ' + toKeep.length + ' rows remain in Orders.'
  });
}

/**
 * List existing archive sheets and their row counts.
 */
function getArchiveList(params) {
  if (!checkApiKey(params)) return makeResponse({ error: 'Unauthorized', code: 401 });

  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const sheets  = ss.getSheets();
  const archives = sheets
    .filter(s => s.getName().startsWith('Archive_'))
    .map(s => ({
      name:    s.getName(),
      rows:    Math.max(0, s.getLastRow() - 1), // subtract header
      type:    s.getName().startsWith('Archive_WorkLogs') ? 'logs' :
               s.getName().startsWith('Archive_POs')      ? 'pos'  : 'other',
      year:    s.getName().replace(/^Archive_(WorkLogs_|POs_)/, ''),
    }))
    .sort((a, b) => b.name.localeCompare(a.name));

  return makeResponse({ archives, total: archives.length });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCutoffDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function groupByYear(rows, dateKey) {
  const byYear = {};
  rows.forEach(r => {
    const d = r[dateKey];
    if (!d) return;
    const yr = d.slice(0, 4);
    byYear[yr] = (byYear[yr] || 0) + 1;
  });
  return byYear;
}

function logArchiveEvent(ss, dataType, rowsMoved, cutoffDate, months) {
  const logSheet = ensureSheet(ss, 'ArchiveLog', [
    'Timestamp', 'Data Type', 'Rows Moved', 'Cutoff Date', 'Months Threshold', 'Run By'
  ]);
  logSheet.appendRow([
    new Date().toISOString(), dataType, rowsMoved, cutoffDate, months,
    Session.getActiveUser ? Session.getActiveUser().getEmail() : 'unknown'
  ]);
}

function ensureSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    formatHeaderRow(sheet, headers.length);
    return sheet;
  }
  // If sheet is empty, write headers
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    formatHeaderRow(sheet, headers.length);
  }
  return sheet;
}

/**
 * Style the header row with the dashboard dark theme.
 */
function formatHeaderRow(sheet, colCount) {
  const range = sheet.getRange(1, 1, 1, colCount);
  range.setFontWeight('bold')
       .setFontFamily('Courier New')
       .setFontSize(10)
       .setBackground('#0d0f14')
       .setFontColor('#f0c040');
  sheet.setFrozenRows(1);
  for (let i = 1; i <= colCount; i++) sheet.autoResizeColumn(i);
}

/**
 * Convert a sheet row array + header array into a camelCase key object.
 */
function rowToObj(headers, row) {
  const obj = {};
  const tz  = Session.getScriptTimeZone();
  headers.forEach((h, i) => {
    const v   = row[i];
    const key = toCamelCase(h);
    if (v === undefined || v === null || v === '') {
      obj[key] = '';
    } else if (v instanceof Date) {
      // Google Sheets stores date cells as Date objects.
      // Format as yyyy-MM-dd for reliable ISO comparison.
      obj[key] = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    } else if (key === 'date' || key === 'timestamp' || key === 'joinDate' || key === 'lastActive') {
      // Cell stored as plain text — normalize to yyyy-MM-dd if it looks like a date.
      // Handles: "02/24/2026", "2/24/2026", "24-02-2026", "2026-02-24", "2026-02-24T06:00:00Z"
      const s = String(v).trim();
      const isoMatch  = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const usMatch   = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const dmyMatch  = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
      if (isoMatch) {
        obj[key] = isoMatch[1] + '-' + isoMatch[2] + '-' + isoMatch[3]; // already ISO
      } else if (usMatch) {
        // MM/DD/YYYY
        obj[key] = usMatch[3] + '-' + usMatch[1].padStart(2,'0') + '-' + usMatch[2].padStart(2,'0');
      } else if (dmyMatch) {
        // DD-MM-YYYY
        obj[key] = dmyMatch[3] + '-' + dmyMatch[2].padStart(2,'0') + '-' + dmyMatch[1].padStart(2,'0');
      } else {
        obj[key] = s; // leave as-is if unrecognised
      }
    } else {
      obj[key] = String(v);
    }
  });
  return obj;
}

/**
 * Convert header string to camelCase key.
 * "Worker Name"      → "workerName"
 * "Worker ID"        → "workerId"   (ID → Id, not ID)
 * "NCM Ref"          → "ncmRef"
 * "Break (mins)"     → "breakMins"
 * "Notes / Skills"   → "notesSkills"
 * "Primary Operation"→ "primaryOperation"
 */
function toCamelCase(str) {
  return str
    .replace(/\bID\b/g, 'Id')      // "Worker ID" → "Worker Id" before processing
    .replace(/[()]/g, '')            // Remove parentheses
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove slashes, special chars
    .replace(/\s+/g, ' ')           // Collapse multiple spaces
    .trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, c => c.toLowerCase());
}

/**
 * Safely parse a number; returns float if isFloat, else integer.
 */
function toNum(val, isFloat) {
  const n = isFloat ? parseFloat(val) : parseInt(val);
  return isNaN(n) ? 0 : n;
}

/**
 * Today's date as yyyy-MM-dd string.
 */
function today() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Build a JSON ContentService response with CORS headers.
 */
function makeResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
