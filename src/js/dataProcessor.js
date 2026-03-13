/**
 * dataProcessor.js — Resolves edit chains via ParentId and builds display rows.
 */
var HLA = HLA || {};

HLA.DataProcessor = (function () {
    "use strict";

    var C = HLA.Constants;

    /**
     * Format a DutyStatusLog status value to a human-readable label.
     */
    function formatStatus(status) {
        if (!status) { return "\u2014"; }
        return C.DutyStatusLabels[status] || status;
    }

    /**
     * Build audit rows from raw DutyStatusLog entries.
     * Only logs with state 2 (Inactive/Changed), 3 (Change Requested),
     * or 4 (Change Rejected) represent edits.
     *
     * @param {Object[]} logs - Raw DutyStatusLog entries
     * @param {Object} userMap - Map of userId -> user object
     * @returns {Object[]} Sorted array of display rows
     */
    function buildAuditRows(logs, userMap) {
        // Index all logs by ID
        var logById = {};
        var i, log;
        for (i = 0; i < logs.length; i++) {
            log = logs[i];
            if (log.id) {
                logById[log.id] = log;
            }
        }

        var rows = [];
        for (i = 0; i < logs.length; i++) {
            log = logs[i];

            // Only include edit records (state 2, 3, or 4)
            if (log.state !== C.EventRecordStatus.INACTIVE_CHANGED &&
                log.state !== C.EventRecordStatus.CHANGE_REQUESTED &&
                log.state !== C.EventRecordStatus.CHANGE_REJECTED) {
                continue;
            }

            // Resolve original status from parent
            var originalStatus = "\u2014";
            if (log.parentId && log.parentId.id && logById[log.parentId.id]) {
                originalStatus = formatStatus(logById[log.parentId.id].status);
            }

            // Resolve who made the edit — show full name + username
            var editedByName = "System";
            var editedByUsername = "";
            if (log.editRequestedByUser && log.editRequestedByUser.id) {
                var editor = userMap[log.editRequestedByUser.id];
                if (editor) {
                    var fullName = ((editor.firstName || "") + " " + (editor.lastName || "")).trim();
                    editedByUsername = editor.name || "";
                    if (fullName && editedByUsername) {
                        editedByName = fullName + " (" + editedByUsername + ")";
                    } else {
                        editedByName = fullName || editedByUsername || "Unknown";
                    }
                }
            }

            // Resolve annotations
            var annotations = "\u2014";
            if (log.annotations && log.annotations.length > 0) {
                var comments = [];
                for (var j = 0; j < log.annotations.length; j++) {
                    if (log.annotations[j].comment) {
                        comments.push(log.annotations[j].comment);
                    }
                }
                if (comments.length > 0) {
                    annotations = comments.join("; ");
                }
            }

            // Resolve driver name
            var driverName = "\u2014";
            if (log.driver && log.driver.id) {
                var driver = userMap[log.driver.id];
                if (driver) {
                    driverName = (driver.firstName || "") + " " + (driver.lastName || "");
                    driverName = driverName.trim() || driver.name || "Unknown";
                }
            }

            rows.push({
                punchDateTime: log.dateTime || "",
                driverName: driverName,
                editDateTime: log.editDateTime || log.dateTime || "",
                editedByName: editedByName,
                originalStatus: originalStatus,
                newStatus: formatStatus(log.status),
                recordState: C.EventRecordStatusLabels[log.state] || "Unknown",
                recordStateCode: log.state,
                annotations: annotations,
                origin: log.origin || "\u2014",
                rawStatus: log.status
            });
        }

        // Sort by editDateTime descending
        rows.sort(function (a, b) {
            if (a.editDateTime > b.editDateTime) return -1;
            if (a.editDateTime < b.editDateTime) return 1;
            return 0;
        });

        return rows;
    }

    /**
     * Build a userMap (id -> user) from an array of user objects.
     */
    function buildUserMap(users) {
        var map = {};
        for (var i = 0; i < users.length; i++) {
            if (users[i].id) {
                map[users[i].id] = users[i];
            }
        }
        return map;
    }

    return {
        buildAuditRows: buildAuditRows,
        buildUserMap: buildUserMap,
        formatStatus: formatStatus
    };
})();
