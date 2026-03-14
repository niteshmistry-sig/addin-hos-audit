/**
 * HOS Log Edit Audit — main.js
 * MyGeotab Add-In: audits HOS DutyStatusLog edits for compliance review.
 */

/* global geotab */
if (typeof geotab === "undefined") { var geotab = { addin: {} }; }

geotab.addin.hosLogEditAudit = function () {
  "use strict";

  // ── State ──
  var api;
  var abortController = null;
  var firstFocus = true;
  var allDrivers = [];
  var driverMap = {};
  var auditRows = [];
  var sortCol = "editDateTime";
  var sortAsc = false;
  var selectedModifiers = {}; // name → true/false; empty = show all

  // ── DOM refs (cached in initialize) ──
  var els = {};

  // ── Constants ──
  var MAX_DATE_RANGE_DAYS = 7;

  var EventRecordStatus = {
    ACTIVE: 1,
    INACTIVE_CHANGED: 2,
    CHANGE_REQUESTED: 3,
    CHANGE_REJECTED: 4
  };

  var EventRecordStatusLabels = {};
  EventRecordStatusLabels[EventRecordStatus.ACTIVE] = "Active";
  EventRecordStatusLabels[EventRecordStatus.INACTIVE_CHANGED] = "Inactive (Changed)";
  EventRecordStatusLabels[EventRecordStatus.CHANGE_REQUESTED] = "Change Requested";
  EventRecordStatusLabels[EventRecordStatus.CHANGE_REJECTED] = "Change Rejected";

  var DutyStatusLabels = {
    "Off": "Off Duty", "ON": "On Duty", "SB": "Sleeper Berth", "D": "Driving",
    "OffDuty": "Off Duty", "SleeperBerth": "Sleeper Berth", "Driving": "Driving",
    "OnDuty": "On Duty", "PC": "Personal Conveyance", "YM": "Yard Move"
  };

  var ALL_STATUSES = [
    EventRecordStatus.ACTIVE, EventRecordStatus.INACTIVE_CHANGED,
    EventRecordStatus.CHANGE_REQUESTED, EventRecordStatus.CHANGE_REJECTED
  ];

  // ══════════════════════════════════════════
  //  Helpers
  // ══════════════════════════════════════════
  function escHtml(s) {
    if (s == null) return "";
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(String(s)));
    return div.innerHTML;
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return "\u2014";
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleString();
    } catch (e) {
      return isoStr;
    }
  }

  function formatStatus(status) {
    if (!status) return "\u2014";
    return DutyStatusLabels[status] || status;
  }

  function showLoading(show, msg) {
    els.loading.style.display = show ? "" : "none";
    if (msg) els.loadingText.textContent = msg;
  }

  function showEmpty(show, msg) {
    els.empty.style.display = show ? "" : "none";
    if (msg) els.empty.querySelector("p").textContent = msg;
  }

  function showError(message) {
    showLoading(false);
    if (message) {
      els.error.textContent = message;
      els.error.style.display = "block";
    } else {
      els.error.style.display = "none";
    }
  }

  function sortArrow(col) {
    if (sortCol === col) {
      return '<span class="hla-sort-arrow active">' + (sortAsc ? "\u25B2" : "\u25BC") + "</span>";
    }
    return '<span class="hla-sort-arrow">\u25B2\u25BC</span>';
  }

  function toLocalISODate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function setDefaults() {
    var today = new Date();
    var sixDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    els.fromDate.value = toLocalISODate(sixDaysAgo);
    els.toDate.value = toLocalISODate(today);
  }

  // ══════════════════════════════════════════
  //  Badge Classes
  // ══════════════════════════════════════════
  function dutyBadgeClass(statusText) {
    var lower = (statusText || "").toLowerCase();
    if (lower.indexOf("off") > -1) return "hla-badge-off";
    if (lower.indexOf("sleeper") > -1) return "hla-badge-sleeper";
    if (lower.indexOf("driving") > -1) return "hla-badge-driving";
    if (lower.indexOf("on duty") > -1 || lower.indexOf("on") === 0) return "hla-badge-on";
    if (lower.indexOf("personal") > -1) return "hla-badge-pc";
    if (lower.indexOf("yard") > -1) return "hla-badge-ym";
    return "hla-badge-default";
  }

  function stateBadgeClass(stateCode) {
    switch (stateCode) {
      case EventRecordStatus.INACTIVE_CHANGED: return "hla-badge-changed";
      case EventRecordStatus.CHANGE_REQUESTED: return "hla-badge-requested";
      case EventRecordStatus.CHANGE_REJECTED: return "hla-badge-rejected";
      default: return "hla-badge-default";
    }
  }

  // ══════════════════════════════════════════
  //  Validation
  // ══════════════════════════════════════════
  function validateDateRange() {
    var from = els.fromDate.value;
    var to = els.toDate.value;
    var driverSelected = els.driverSelect.value !== "";

    if (!from || !to) {
      els.dateError.style.display = "none";
      els.searchBtn.disabled = true;
      return false;
    }

    var fromDate = new Date(from + "T00:00:00");
    var toDate = new Date(to + "T00:00:00");
    var diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays < 0) {
      els.dateError.textContent = "\"From\" date must be before \"To\" date";
      els.dateError.style.display = "inline";
      els.searchBtn.disabled = true;
      return false;
    }

    if (diffDays > MAX_DATE_RANGE_DAYS) {
      els.dateError.textContent = "Date range must be " + MAX_DATE_RANGE_DAYS + " days or less";
      els.dateError.style.display = "inline";
      els.searchBtn.disabled = true;
      return false;
    }

    els.dateError.style.display = "none";
    els.searchBtn.disabled = !driverSelected;
    return driverSelected;
  }

  // ══════════════════════════════════════════
  //  Foundation Data (loaded in initialize)
  // ══════════════════════════════════════════
  function loadFoundation(callback) {
    api.multiCall([
      ["Get", { typeName: "User", search: { isDriver: true }, resultsLimit: 50000 }]
    ], function (results) {
      allDrivers = results[0] || [];
      populateDrivers();
      callback();
    }, function (err) {
      console.error("Foundation load error:", err);
      callback();
    });
  }

  function populateDrivers() {
    var drivers = allDrivers.slice().sort(function (a, b) {
      var na = ((a.firstName || "") + " " + (a.lastName || "")).trim().toLowerCase();
      var nb = ((b.firstName || "") + " " + (b.lastName || "")).trim().toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });

    driverMap = {};
    for (var i = 0; i < drivers.length; i++) {
      driverMap[drivers[i].id] = drivers[i];
    }

    els.driverSelect.innerHTML = '<option value="">-- Select Driver (' + drivers.length + ') --</option>';
    for (var j = 0; j < drivers.length; j++) {
      var d = drivers[j];
      var name = ((d.firstName || "") + " " + (d.lastName || "")).trim() || d.name || d.id;
      var opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = name;
      els.driverSelect.appendChild(opt);
    }
  }

  // ══════════════════════════════════════════
  //  Data Processing
  // ══════════════════════════════════════════
  function buildUserMap(users) {
    var map = {};
    for (var i = 0; i < users.length; i++) {
      if (users[i].id) map[users[i].id] = users[i];
    }
    return map;
  }

  function buildAuditRows(logs, userMap, audits) {
    var logById = {};
    var i, log;
    for (i = 0; i < logs.length; i++) {
      log = logs[i];
      if (log.id) logById[log.id] = log;
    }

    // Build a username→user lookup so we can resolve Audit.userName
    var userByName = {};
    var uid;
    for (uid in userMap) {
      if (userMap[uid].name) {
        userByName[userMap[uid].name.toLowerCase()] = userMap[uid];
      }
    }

    // Index audits by approximate dateTime (within 60s) for cross-reference
    var auditIndex = [];
    if (audits && audits.length > 0) {
      for (i = 0; i < audits.length; i++) {
        auditIndex.push({
          dateTime: audits[i].dateTime ? new Date(audits[i].dateTime).getTime() : 0,
          userName: audits[i].userName || "",
          name: audits[i].name || "",
          comment: audits[i].comment || ""
        });
      }
    }

    function resolveEditorName(log) {
      // 1. Try editRequestedByUser on the log itself
      if (log.editRequestedByUser && log.editRequestedByUser.id) {
        var editor = userMap[log.editRequestedByUser.id];
        if (editor) {
          var fullName = ((editor.firstName || "") + " " + (editor.lastName || "")).trim();
          var username = editor.name || "";
          if (fullName && username) return fullName + " (" + username + ")";
          return fullName || username || "Unknown";
        }
      }

      // 2. Fall back to matching Audit records by dateTime proximity
      var editTime = new Date(log.editDateTime || log.dateTime || "").getTime();
      if (editTime && auditIndex.length > 0) {
        var bestMatch = null;
        var bestDelta = Infinity;
        for (var a = 0; a < auditIndex.length; a++) {
          var delta = Math.abs(auditIndex[a].dateTime - editTime);
          if (delta < bestDelta && delta < 60000) { // within 60 seconds
            bestDelta = delta;
            bestMatch = auditIndex[a];
          }
        }
        if (bestMatch && bestMatch.userName) {
          var resolved = userByName[bestMatch.userName.toLowerCase()];
          if (resolved) {
            var fn = ((resolved.firstName || "") + " " + (resolved.lastName || "")).trim();
            var un = resolved.name || "";
            if (fn && un) return fn + " (" + un + ")";
            return fn || un || bestMatch.userName;
          }
          return bestMatch.userName;
        }
      }

      return "System";
    }

    var rows = [];
    for (i = 0; i < logs.length; i++) {
      log = logs[i];

      if (log.state !== EventRecordStatus.INACTIVE_CHANGED &&
          log.state !== EventRecordStatus.CHANGE_REQUESTED &&
          log.state !== EventRecordStatus.CHANGE_REJECTED) {
        continue;
      }

      var originalStatus = "\u2014";
      if (log.parentId && log.parentId.id && logById[log.parentId.id]) {
        originalStatus = formatStatus(logById[log.parentId.id].status);
      }

      var editedByName = resolveEditorName(log);

      var annotations = "\u2014";
      if (log.annotations && log.annotations.length > 0) {
        var comments = [];
        for (var j = 0; j < log.annotations.length; j++) {
          if (log.annotations[j].comment) comments.push(log.annotations[j].comment);
        }
        if (comments.length > 0) annotations = comments.join("; ");
      }

      var driverName = "\u2014";
      if (log.driver && log.driver.id) {
        var driver = userMap[log.driver.id];
        if (driver) {
          driverName = ((driver.firstName || "") + " " + (driver.lastName || "")).trim() || driver.name || "Unknown";
        }
      }

      // Determine edit type: if log has a parentId it's a modification, otherwise an insertion
      var editType = (log.parentId && log.parentId.id) ? "Edit" : "Add";

      rows.push({
        punchDateTime: log.dateTime || "",
        driverName: driverName,
        editDateTime: log.editDateTime || log.dateTime || "",
        editedByName: editedByName,
        editType: editType,
        originalStatus: originalStatus,
        newStatus: formatStatus(log.status),
        recordState: EventRecordStatusLabels[log.state] || "Unknown",
        recordStateCode: log.state,
        annotations: annotations,
        origin: log.origin || "\u2014",
        rawStatus: log.status
      });
    }

    rows.sort(function (a, b) {
      return a.editDateTime > b.editDateTime ? -1 : a.editDateTime < b.editDateTime ? 1 : 0;
    });

    return rows;
  }

  // ══════════════════════════════════════════
  //  Search
  // ══════════════════════════════════════════
  function performSearch() {
    var driverId = els.driverSelect.value;
    if (!driverId) return;

    var fromDate = els.fromDate.value + "T00:00:00.000Z";
    var toDate = els.toDate.value + "T23:59:59.999Z";

    if (abortController) abortController.abort();
    abortController = new AbortController();

    showEmpty(false);
    showError(null);
    showLoading(true, "Fetching HOS log data\u2026");

    api.multiCall([
      ["Get", {
        typeName: "DutyStatusLog",
        search: {
          userSearch: { id: driverId },
          fromDate: fromDate, toDate: toDate,
          statuses: ALL_STATUSES,
          includeModifications: true
        },
        resultsLimit: 25000
      }],
      ["Get", { typeName: "User", resultsLimit: 50000 }],
      ["Get", {
        typeName: "Audit",
        search: { name: "Edit HOS log", fromDate: fromDate, toDate: toDate },
        resultsLimit: 50000
      }],
      ["Get", {
        typeName: "Audit",
        search: { name: "Add HOS log", fromDate: fromDate, toDate: toDate },
        resultsLimit: 50000
      }]
    ], function (results) {
      if (abortController && abortController.signal.aborted) return;

      var logs = results[0] || [];
      var users = results[1] || [];
      var editAudits = results[2] || [];
      var addAudits = results[3] || [];
      var userMap = buildUserMap(users);
      var audits = editAudits.concat(addAudits);
      auditRows = buildAuditRows(logs, userMap, audits);

      els.resultsHeader.style.display = "flex";
      populateModifierFilter();
      renderTable();
      showLoading(false);
    }, function (err) {
      if (abortController && abortController.signal.aborted) return;
      showError("Failed to fetch HOS data: " + (err.message || err));
      console.error("HLA fetch error:", err);
    });
  }

  // ══════════════════════════════════════════
  //  Modifier Filter
  // ══════════════════════════════════════════
  function getUniqueModifiers() {
    var names = {};
    for (var i = 0; i < auditRows.length; i++) {
      var name = auditRows[i].editedByName || "Unknown";
      names[name] = true;
    }
    return Object.keys(names).sort(function (a, b) {
      return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
    });
  }

  function populateModifierFilter() {
    var names = getUniqueModifiers();
    selectedModifiers = {};
    for (var i = 0; i < names.length; i++) {
      selectedModifiers[names[i]] = true;
    }
    rebuildModifierMenu();
    els.modifierFilter.style.display = names.length > 0 ? "" : "none";
  }

  function rebuildModifierMenu() {
    var names = getUniqueModifiers();
    var allSelected = true;
    var noneSelected = true;
    for (var i = 0; i < names.length; i++) {
      if (!selectedModifiers[names[i]]) allSelected = false;
      else noneSelected = false;
    }

    var html = '<label class="hla-dropdown-item hla-dropdown-item-all">' +
      '<input type="checkbox" id="hla-mod-select-all" ' + (allSelected ? "checked" : "") + '> <strong>Select All</strong></label>';
    for (var j = 0; j < names.length; j++) {
      var checked = selectedModifiers[names[j]] ? "checked" : "";
      html += '<label class="hla-dropdown-item">' +
        '<input type="checkbox" data-modifier="' + escHtml(names[j]) + '" ' + checked + '> ' + escHtml(names[j]) + '</label>';
    }
    els.modifierMenu.innerHTML = html;
    updateModifierToggleLabel(names, allSelected);
  }

  function updateModifierToggleLabel(names, allSelected) {
    if (!names) names = getUniqueModifiers();
    if (allSelected === undefined) {
      allSelected = true;
      for (var i = 0; i < names.length; i++) {
        if (!selectedModifiers[names[i]]) { allSelected = false; break; }
      }
    }
    var count = 0;
    for (var k = 0; k < names.length; k++) {
      if (selectedModifiers[names[k]]) count++;
    }
    if (allSelected || count === names.length) {
      els.modifierToggle.innerHTML = 'All <span class="hla-caret">&#x25BC;</span>';
    } else if (count === 0) {
      els.modifierToggle.innerHTML = 'None <span class="hla-caret">&#x25BC;</span>';
    } else if (count === 1) {
      for (var m = 0; m < names.length; m++) {
        if (selectedModifiers[names[m]]) {
          els.modifierToggle.innerHTML = escHtml(names[m]) + ' <span class="hla-caret">&#x25BC;</span>';
          break;
        }
      }
    } else {
      els.modifierToggle.innerHTML = count + ' selected <span class="hla-caret">&#x25BC;</span>';
    }
  }

  function getFilteredRows() {
    var names = getUniqueModifiers();
    var allSelected = true;
    for (var i = 0; i < names.length; i++) {
      if (!selectedModifiers[names[i]]) { allSelected = false; break; }
    }
    if (allSelected) return auditRows;

    var filtered = [];
    for (var j = 0; j < auditRows.length; j++) {
      var name = auditRows[j].editedByName || "Unknown";
      if (selectedModifiers[name]) filtered.push(auditRows[j]);
    }
    return filtered;
  }

  // ══════════════════════════════════════════
  //  Rendering
  // ══════════════════════════════════════════
  function renderTable() {
    var rows = getFilteredRows();
    els.resultCount.textContent = rows.length + " edit" + (rows.length !== 1 ? "s" : "") + " found";

    // Update headers with sort arrows
    var thead = els.auditTable.querySelector("thead");
    thead.innerHTML = "<tr>" +
      '<th class="hla-sortable" data-sort="punchDateTime">Punch Date/Time ' + sortArrow("punchDateTime") + "</th>" +
      '<th class="hla-sortable" data-sort="driverName">Driver ' + sortArrow("driverName") + "</th>" +
      '<th class="hla-sortable" data-sort="editDateTime">Edit Date/Time ' + sortArrow("editDateTime") + "</th>" +
      '<th class="hla-sortable" data-sort="editedByName">Modified By ' + sortArrow("editedByName") + "</th>" +
      '<th class="hla-sortable" data-sort="editType">Type ' + sortArrow("editType") + "</th>" +
      '<th class="hla-sortable" data-sort="originalStatus">Original Status ' + sortArrow("originalStatus") + "</th>" +
      '<th class="hla-sortable" data-sort="newStatus">New Status ' + sortArrow("newStatus") + "</th>" +
      '<th class="hla-sortable" data-sort="recordState">Record State ' + sortArrow("recordState") + "</th>" +
      "<th>Annotations</th>" +
      '<th class="hla-sortable" data-sort="origin">Origin ' + sortArrow("origin") + "</th>" +
      "</tr>";

    var tbody = els.tableBody;
    tbody.innerHTML = "";

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:#999;">No HOS log edits found for this driver and date range.</td></tr>';
      return;
    }

    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var typeBadge = r.editType === "Add" ? "hla-badge-add" : "hla-badge-edit";
      html += '<tr>';
      html += '<td>' + escHtml(formatDateTime(r.punchDateTime)) + '</td>';
      html += '<td>' + escHtml(r.driverName) + '</td>';
      html += '<td>' + escHtml(formatDateTime(r.editDateTime)) + '</td>';
      html += '<td>' + escHtml(r.editedByName) + '</td>';
      html += '<td><span class="hla-badge ' + typeBadge + '">' + escHtml(r.editType) + '</span></td>';
      html += '<td><span class="hla-badge ' + dutyBadgeClass(r.originalStatus) + '">' + escHtml(r.originalStatus) + '</span></td>';
      html += '<td><span class="hla-badge ' + dutyBadgeClass(r.newStatus) + '">' + escHtml(r.newStatus) + '</span></td>';
      html += '<td><span class="hla-badge ' + stateBadgeClass(r.recordStateCode) + '">' + escHtml(r.recordState) + '</span></td>';
      html += '<td class="hla-cell-annotations">' + escHtml(r.annotations) + '</td>';
      html += '<td>' + escHtml(r.origin) + '</td>';
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }

  // ══════════════════════════════════════════
  //  CSV Export
  // ══════════════════════════════════════════
  function exportCSV() {
    var exportRows = getFilteredRows();
    if (exportRows.length === 0) return;

    var headers = ["Punch Date/Time", "Driver", "Edit Date/Time", "Modified By", "Type",
                   "Original Status", "New Status", "Record State", "Annotations", "Origin"];

    var csvRows = [headers.join(",")];
    for (var i = 0; i < exportRows.length; i++) {
      var r = exportRows[i];
      var row = [
        '"' + formatDateTime(r.punchDateTime).replace(/"/g, '""') + '"',
        '"' + (r.driverName || "").replace(/"/g, '""') + '"',
        '"' + formatDateTime(r.editDateTime).replace(/"/g, '""') + '"',
        '"' + (r.editedByName || "").replace(/"/g, '""') + '"',
        '"' + (r.editType || "").replace(/"/g, '""') + '"',
        '"' + (r.originalStatus || "").replace(/"/g, '""') + '"',
        '"' + (r.newStatus || "").replace(/"/g, '""') + '"',
        '"' + (r.recordState || "").replace(/"/g, '""') + '"',
        '"' + (r.annotations || "").replace(/"/g, '""') + '"',
        '"' + (r.origin || "").replace(/"/g, '""') + '"'
      ];
      csvRows.push(row.join(","));
    }

    var csvContent = csvRows.join("\n");
    var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "hos_log_edit_audit_" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ══════════════════════════════════════════
  //  Event Wiring
  // ══════════════════════════════════════════
  function wireEvents() {
    // Search button
    els.searchBtn.addEventListener("click", function () {
      if (validateDateRange()) performSearch();
    });

    // Validation on change
    els.fromDate.addEventListener("change", function () { validateDateRange(); });
    els.toDate.addEventListener("change", function () { validateDateRange(); });
    els.driverSelect.addEventListener("change", function () { validateDateRange(); });

    // CSV export
    els.csvBtn.addEventListener("click", function () { exportCSV(); });

    // Modifier filter dropdown toggle
    els.modifierToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      els.modifierDropdown.classList.toggle("hla-dropdown-open");
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", function (e) {
      if (!els.modifierDropdown.contains(e.target)) {
        els.modifierDropdown.classList.remove("hla-dropdown-open");
      }
    });

    // Modifier filter checkbox changes (delegation)
    els.modifierMenu.addEventListener("change", function (e) {
      var checkbox = e.target;
      if (checkbox.id === "hla-mod-select-all") {
        var names = getUniqueModifiers();
        for (var i = 0; i < names.length; i++) {
          selectedModifiers[names[i]] = checkbox.checked;
        }
        rebuildModifierMenu();
      } else {
        var modifier = checkbox.getAttribute("data-modifier");
        if (modifier) {
          selectedModifiers[modifier] = checkbox.checked;
          var selectAll = els.modifierMenu.querySelector("#hla-mod-select-all");
          if (selectAll) {
            var allChecked = true;
            var names2 = getUniqueModifiers();
            for (var j = 0; j < names2.length; j++) {
              if (!selectedModifiers[names2[j]]) { allChecked = false; break; }
            }
            selectAll.checked = allChecked;
          }
          updateModifierToggleLabel();
        }
      }
      renderTable();
    });

    // Table sorting (delegation)
    els.auditTable.addEventListener("click", function (e) {
      var th = e.target.closest("th.hla-sortable");
      if (!th) return;
      var col = th.getAttribute("data-sort");
      if (!col) return;

      if (sortCol === col) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col;
        sortAsc = true;
      }

      auditRows.sort(function (a, b) {
        var va = a[col] || "";
        var vb = b[col] || "";
        if (typeof va === "string") va = va.toLowerCase();
        if (typeof vb === "string") vb = vb.toLowerCase();
        return va < vb ? (sortAsc ? -1 : 1) : va > vb ? (sortAsc ? 1 : -1) : 0;
      });

      renderTable();
    });
  }

  // ══════════════════════════════════════════
  //  MyGeotab Lifecycle
  // ══════════════════════════════════════════
  return {
    initialize: function (freshApi, state, callback) {
      api = freshApi;

      // Cache DOM refs
      els.loading = document.getElementById("hla-loading");
      els.loadingText = document.getElementById("hla-loading-text");
      els.empty = document.getElementById("hla-empty");
      els.error = document.getElementById("hla-error");
      els.driverSelect = document.getElementById("hla-driver-select");
      els.fromDate = document.getElementById("hla-from-date");
      els.toDate = document.getElementById("hla-to-date");
      els.dateError = document.getElementById("hla-date-error");
      els.searchBtn = document.getElementById("hla-search-btn");
      els.resultsHeader = document.getElementById("hla-results-header");
      els.resultCount = document.getElementById("hla-result-count");
      els.csvBtn = document.getElementById("hla-csv-btn");
      els.auditTable = document.getElementById("hla-audit-table");
      els.tableBody = document.getElementById("hla-table-body");
      els.modifierFilter = document.getElementById("hla-modifier-filter");
      els.modifierDropdown = document.getElementById("hla-modifier-dropdown");
      els.modifierToggle = document.getElementById("hla-modifier-toggle");
      els.modifierMenu = document.getElementById("hla-modifier-menu");

      wireEvents();
      setDefaults();

      if (api) {
        loadFoundation(callback);
      } else {
        callback();
      }
    },

    focus: function (freshApi, state) {
      api = freshApi;

      if (firstFocus) {
        firstFocus = false;
      }
    },

    blur: function () {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      showLoading(false);
    }
  };
};

// ══════════════════════════════════════════
//  Standalone Mode (preview outside MyGeotab)
// ══════════════════════════════════════════
(function () {
  setTimeout(function () {
    if (typeof geotab !== "undefined" && typeof geotab.addin.hosLogEditAudit === "function") {
      var root = document.getElementById("hla-root");
      if (root && !root._initialized) {
        root._initialized = true;

        // Build mock API for standalone preview
        var now = new Date();
        var hoursAgo = function (h) { return new Date(now.getTime() - h * 3600000).toISOString(); };

        var mockDrivers = [
          { id: "u1", firstName: "John", lastName: "Smith", name: "jsmith", isDriver: true },
          { id: "u2", firstName: "Jane", lastName: "Doe", name: "jdoe", isDriver: true },
          { id: "u3", firstName: "Mike", lastName: "Johnson", name: "mjohnson", isDriver: true },
          { id: "u4", firstName: "Sarah", lastName: "Williams", name: "swilliams", isDriver: true },
          { id: "u5", firstName: "Admin", lastName: "User", name: "admin" }
        ];

        var mockLogs = [
          // Active original records
          { id: "log1", state: 1, status: "D", dateTime: hoursAgo(48), driver: {id: "u1"}, origin: "Automatic" },
          { id: "log3", state: 1, status: "ON", dateTime: hoursAgo(72), driver: {id: "u1"}, origin: "Automatic" },
          { id: "log6", state: 1, status: "Off", dateTime: hoursAgo(30), driver: {id: "u2"}, origin: "Automatic" },
          // Edits of existing logs (have parentId)
          { id: "log2", state: 2, status: "ON", dateTime: hoursAgo(48), editDateTime: hoursAgo(24),
            parentId: {id: "log1"}, driver: {id: "u1"}, editRequestedByUser: {id: "u5"},
            annotations: [{comment: "Driver was at dock, not driving"}], origin: "Manual" },
          { id: "log4", state: 3, status: "Off", dateTime: hoursAgo(72), editDateTime: hoursAgo(36),
            parentId: {id: "log3"}, driver: {id: "u1"}, editRequestedByUser: {id: "u1"},
            annotations: [{comment: "Was off duty, system logged incorrectly"}], origin: "Manual" },
          { id: "log5", state: 4, status: "SB", dateTime: hoursAgo(60), editDateTime: hoursAgo(12),
            parentId: {id: "log3"}, driver: {id: "u1"}, editRequestedByUser: {id: "u1"},
            annotations: [{comment: "No evidence of sleeper berth usage"}], origin: "Manual" },
          { id: "log7", state: 2, status: "ON", dateTime: hoursAgo(30), editDateTime: hoursAgo(10),
            parentId: {id: "log6"}, driver: {id: "u2"}, editRequestedByUser: {id: "u5"},
            annotations: [{comment: "Pre-trip inspection"}, {comment: "Confirmed by dispatch"}], origin: "Manual" },
          // Inserted new logs (no parentId = Add type)
          { id: "log8", state: 2, status: "D", dateTime: hoursAgo(20), editDateTime: hoursAgo(5),
            driver: {id: "u1"}, editRequestedByUser: {id: "u5"},
            annotations: [{comment: "Added missing driving segment"}], origin: "Manual" },
          { id: "log9", state: 2, status: "SB", dateTime: hoursAgo(40), editDateTime: hoursAgo(8),
            driver: {id: "u1"},
            annotations: [{comment: "Sleeper berth not recorded by ELD"}], origin: "Manual" },
          { id: "log10", state: 3, status: "Off", dateTime: hoursAgo(18), editDateTime: hoursAgo(3),
            driver: {id: "u2"},
            annotations: [{comment: "Driver requested off-duty addition"}], origin: "Manual" }
        ];

        // Mock audit records — covers "Add HOS log" entries where editRequestedByUser may be missing
        var mockAudits = [
          { name: "Add HOS log", userName: "admin", dateTime: hoursAgo(8), comment: "Added SB for u1" },
          { name: "Add HOS log", userName: "jdoe", dateTime: hoursAgo(3), comment: "Added Off for u2" },
          { name: "Edit HOS log", userName: "admin", dateTime: hoursAgo(24), comment: "Edited log for u1" },
          { name: "Edit HOS log", userName: "jsmith", dateTime: hoursAgo(36), comment: "Edited log for u1" }
        ];

        var mockApi = {
          multiCall: function (calls, success) {
            var results = calls.map(function (call) {
              var typeName = call[1].typeName;
              var search = call[1].search || {};
              switch (typeName) {
                case "User":
                  if (search.isDriver) return mockDrivers.filter(function(d) { return d.isDriver; });
                  return mockDrivers;
                case "DutyStatusLog":
                  var driverId = search.userSearch ? search.userSearch.id : null;
                  if (driverId) return mockLogs.filter(function (l) { return l.driver && l.driver.id === driverId; });
                  return mockLogs;
                case "Audit":
                  var auditName = search.name || "";
                  return mockAudits.filter(function (a) { return a.name === auditName; });
                default:
                  return [];
              }
            });
            setTimeout(function () { success(results); }, 300);
          }
        };

        var addin = geotab.addin.hosLogEditAudit();
        addin.initialize(mockApi, {}, function () {
          addin.focus(mockApi, {});
        });
      }
    }
  }, 2000);
})();
