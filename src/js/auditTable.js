/**
 * auditTable.js — Table rendering, sorting, and CSV export.
 */
var HLA = HLA || {};

HLA.AuditTable = (function () {
    "use strict";

    var C = HLA.Constants;
    var _rows = [];
    var _sortCol = "editDateTime";
    var _sortAsc = false;

    /**
     * XSS-safe text escaping via DOM createTextNode.
     */
    function escHtml(str) {
        var div = document.createElement("div");
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /**
     * Format an ISO datetime string for display.
     */
    function formatDateTime(isoStr) {
        if (!isoStr) { return "\u2014"; }
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) { return isoStr; }
            return d.toLocaleString();
        } catch (e) {
            return isoStr;
        }
    }

    /**
     * Get CSS class for a duty status badge.
     */
    function dutyBadgeClass(statusText) {
        var lower = (statusText || "").toLowerCase();
        if (lower.indexOf("off") > -1) return "hla-badge--off";
        if (lower.indexOf("sleeper") > -1) return "hla-badge--sleeper";
        if (lower.indexOf("driving") > -1) return "hla-badge--driving";
        if (lower.indexOf("on duty") > -1 || lower.indexOf("on") === 0) return "hla-badge--on";
        if (lower.indexOf("personal") > -1) return "hla-badge--pc";
        if (lower.indexOf("yard") > -1) return "hla-badge--ym";
        return "hla-badge--default";
    }

    /**
     * Get CSS class for a record state badge.
     */
    function stateBadgeClass(stateCode) {
        switch (stateCode) {
            case C.EventRecordStatus.INACTIVE_CHANGED: return "hla-badge--changed";
            case C.EventRecordStatus.CHANGE_REQUESTED: return "hla-badge--requested";
            case C.EventRecordStatus.CHANGE_REJECTED: return "hla-badge--rejected";
            default: return "hla-badge--default";
        }
    }

    /**
     * Sort the current rows by a column key.
     */
    function sortRows(colKey) {
        if (_sortCol === colKey) {
            _sortAsc = !_sortAsc;
        } else {
            _sortCol = colKey;
            _sortAsc = true;
        }

        _rows.sort(function (a, b) {
            var va = a[colKey] || "";
            var vb = b[colKey] || "";
            if (typeof va === "string") { va = va.toLowerCase(); }
            if (typeof vb === "string") { vb = vb.toLowerCase(); }
            if (va < vb) return _sortAsc ? -1 : 1;
            if (va > vb) return _sortAsc ? 1 : -1;
            return 0;
        });
    }

    /**
     * Render the audit rows into the table body.
     */
    function render(rows) {
        _rows = rows;
        var tbody = document.getElementById("hlaTableBody");
        if (!tbody) { return; }

        var countEl = document.getElementById("hlaResultCount");
        if (countEl) {
            countEl.textContent = rows.length + " edit" + (rows.length !== 1 ? "s" : "") + " found";
        }

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="hla-empty">No HOS log edits found for this driver and date range.</td></tr>';
            return;
        }

        var html = "";
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            html += '<tr class="hla-table__row">';
            html += '<td class="hla-table__cell">' + escHtml(formatDateTime(r.punchDateTime)) + '</td>';
            html += '<td class="hla-table__cell">' + escHtml(r.driverName) + '</td>';
            html += '<td class="hla-table__cell">' + escHtml(formatDateTime(r.editDateTime)) + '</td>';
            html += '<td class="hla-table__cell">' + escHtml(r.editedByName) + '</td>';
            html += '<td class="hla-table__cell"><span class="hla-badge ' + dutyBadgeClass(r.originalStatus) + '">' + escHtml(r.originalStatus) + '</span></td>';
            html += '<td class="hla-table__cell"><span class="hla-badge ' + dutyBadgeClass(r.newStatus) + '">' + escHtml(r.newStatus) + '</span></td>';
            html += '<td class="hla-table__cell"><span class="hla-badge ' + stateBadgeClass(r.recordStateCode) + '">' + escHtml(r.recordState) + '</span></td>';
            html += '<td class="hla-table__cell hla-table__cell--annotations">' + escHtml(r.annotations) + '</td>';
            html += '<td class="hla-table__cell">' + escHtml(r.origin) + '</td>';
            html += '</tr>';
        }
        tbody.innerHTML = html;
    }

    /**
     * Bind sort click handlers to table headers.
     */
    function bindSort() {
        var headers = document.querySelectorAll("#hlaContainer .hla-table__th[data-sort]");
        for (var i = 0; i < headers.length; i++) {
            (function (th) {
                th.addEventListener("click", function () {
                    var col = th.getAttribute("data-sort");
                    sortRows(col);
                    render(_rows);
                    updateSortIndicators(col);
                });
            })(headers[i]);
        }
    }

    /**
     * Update sort direction indicators on table headers.
     */
    function updateSortIndicators(activeCol) {
        var headers = document.querySelectorAll("#hlaContainer .hla-table__th[data-sort]");
        for (var i = 0; i < headers.length; i++) {
            var th = headers[i];
            th.classList.remove("hla-sort--asc", "hla-sort--desc");
            if (th.getAttribute("data-sort") === activeCol) {
                th.classList.add(_sortAsc ? "hla-sort--asc" : "hla-sort--desc");
            }
        }
    }

    /**
     * Export current rows as CSV via Blob download.
     */
    function exportCSV() {
        if (_rows.length === 0) { return; }

        var headers = ["Punch Date/Time", "Driver", "Edit Date/Time", "Edited By",
                       "Original Status", "New Status", "Record State", "Annotations", "Origin"];

        var csvRows = [headers.join(",")];
        for (var i = 0; i < _rows.length; i++) {
            var r = _rows[i];
            var row = [
                '"' + formatDateTime(r.punchDateTime).replace(/"/g, '""') + '"',
                '"' + (r.driverName || "").replace(/"/g, '""') + '"',
                '"' + formatDateTime(r.editDateTime).replace(/"/g, '""') + '"',
                '"' + (r.editedByName || "").replace(/"/g, '""') + '"',
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

    return {
        render: render,
        bindSort: bindSort,
        exportCSV: exportCSV
    };
})();
