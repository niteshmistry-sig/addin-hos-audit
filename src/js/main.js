/**
 * main.js — MyGeotab add-in lifecycle host for HOS Log Edit Audit.
 * Coordinates initialization, filter UI, search, and data flow.
 * In standalone mode (no geotab global), uses mock data for UI preview.
 */
var HLA = HLA || {};

// Provide geotab stub when running standalone (preview mode)
if (typeof geotab === "undefined") {
    var geotab = { addin: {} };
}

geotab.addin.hos_log_edit_audit = function () {
    "use strict";

    var C = HLA.Constants;
    var _api, _page;
    var _driverMap = {}; // id -> user

    // -- Loading / Error states ------------------------------------

    function showLoading(message) {
        var el = document.getElementById("hlaLoading");
        if (el) {
            var span = el.querySelector("span");
            if (span) { span.textContent = message || "Loading\u2026"; }
            el.style.display = "flex";
        }
        var err = document.getElementById("hlaError");
        if (err) { err.style.display = "none"; }
    }

    function hideLoading() {
        var el = document.getElementById("hlaLoading");
        if (el) { el.style.display = "none"; }
    }

    function showError(message) {
        hideLoading();
        var el = document.getElementById("hlaError");
        if (el) {
            el.textContent = message;
            el.style.display = "block";
        }
    }

    // -- Date helpers ----------------------------------------------

    function toLocalISODate(date) {
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, "0");
        var d = String(date.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + d;
    }

    function setDefaultDates() {
        var today = new Date();
        var sixDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);

        var fromInput = document.getElementById("hlaFromDate");
        var toInput = document.getElementById("hlaToDate");
        if (fromInput) { fromInput.value = toLocalISODate(sixDaysAgo); }
        if (toInput) { toInput.value = toLocalISODate(today); }
    }

    function validateDateRange() {
        var fromInput = document.getElementById("hlaFromDate");
        var toInput = document.getElementById("hlaToDate");
        var errorEl = document.getElementById("hlaDateError");
        var searchBtn = document.getElementById("hlaSearchBtn");
        var driverSelect = document.getElementById("hlaDriverSelect");

        if (!fromInput || !toInput) { return false; }

        var from = fromInput.value;
        var to = toInput.value;

        // Check driver is selected
        var driverSelected = driverSelect && driverSelect.value !== "";

        if (!from || !to) {
            if (errorEl) { errorEl.style.display = "none"; }
            if (searchBtn) { searchBtn.disabled = true; }
            return false;
        }

        var fromDate = new Date(from + "T00:00:00");
        var toDate = new Date(to + "T00:00:00");
        var diffMs = toDate.getTime() - fromDate.getTime();
        var diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (diffDays < 0) {
            if (errorEl) {
                errorEl.textContent = "\"From\" date must be before \"To\" date";
                errorEl.style.display = "inline";
            }
            if (searchBtn) { searchBtn.disabled = true; }
            return false;
        }

        if (diffDays > C.MAX_DATE_RANGE_DAYS) {
            if (errorEl) {
                errorEl.textContent = "Date range must be " + C.MAX_DATE_RANGE_DAYS + " days or less";
                errorEl.style.display = "inline";
            }
            if (searchBtn) { searchBtn.disabled = true; }
            return false;
        }

        if (errorEl) { errorEl.style.display = "none"; }
        if (searchBtn) { searchBtn.disabled = !driverSelected; }
        return driverSelected;
    }

    // -- Driver dropdown -------------------------------------------

    function populateDrivers(drivers) {
        var select = document.getElementById("hlaDriverSelect");
        if (!select) { return; }

        // Sort by name
        drivers.sort(function (a, b) {
            var na = ((a.firstName || "") + " " + (a.lastName || "")).trim().toLowerCase();
            var nb = ((b.firstName || "") + " " + (b.lastName || "")).trim().toLowerCase();
            if (na < nb) return -1;
            if (na > nb) return 1;
            return 0;
        });

        // Build map
        _driverMap = {};
        for (var i = 0; i < drivers.length; i++) {
            _driverMap[drivers[i].id] = drivers[i];
        }

        // Populate dropdown
        select.innerHTML = '<option value="">-- Select Driver (' + drivers.length + ') --</option>';
        for (var j = 0; j < drivers.length; j++) {
            var d = drivers[j];
            var name = ((d.firstName || "") + " " + (d.lastName || "")).trim() || d.name || d.id;
            var opt = document.createElement("option");
            opt.value = d.id;
            opt.textContent = name;
            select.appendChild(opt);
        }
    }

    // -- Search / Results ------------------------------------------

    function performSearch() {
        var driverSelect = document.getElementById("hlaDriverSelect");
        var fromInput = document.getElementById("hlaFromDate");
        var toInput = document.getElementById("hlaToDate");

        if (!driverSelect || !fromInput || !toInput) { return; }

        var driverId = driverSelect.value;
        var fromDate = fromInput.value + "T00:00:00.000Z";
        var toDate = toInput.value + "T23:59:59.999Z";

        if (!driverId) { return; }

        // Hide empty state, show table
        var emptyState = document.getElementById("hlaEmptyState");
        if (emptyState) { emptyState.style.display = "none"; }

        showLoading("Fetching HOS log data\u2026");

        HLA.AuditService.fetchAuditData(_api, driverId, fromDate, toDate)
            .then(function (data) {
                var userMap = HLA.DataProcessor.buildUserMap(data.users);
                var rows = HLA.DataProcessor.buildAuditRows(data.logs, userMap);

                // Show results
                var tableWrap = document.querySelector("#hlaContainer .hla-table-wrap");
                var resultsHeader = document.getElementById("hlaResultsHeader");
                if (tableWrap) { tableWrap.setAttribute("style", "display: block;"); }
                if (resultsHeader) { resultsHeader.style.display = "flex"; }

                HLA.AuditTable.render(rows);
                hideLoading();
            })
            .catch(function (err) {
                showError("Failed to fetch HOS data: " + (err.message || err));
                console.error("HLA fetch error:", err);
            });
    }

    // -- Event binding ---------------------------------------------

    function bindEvents() {
        var searchBtn = document.getElementById("hlaSearchBtn");
        var fromInput = document.getElementById("hlaFromDate");
        var toInput = document.getElementById("hlaToDate");
        var driverSelect = document.getElementById("hlaDriverSelect");
        var csvBtn = document.getElementById("hlaCsvBtn");

        if (searchBtn) {
            searchBtn.addEventListener("click", function () {
                if (validateDateRange()) {
                    performSearch();
                }
            });
        }

        if (fromInput) { fromInput.addEventListener("change", function () { validateDateRange(); }); }
        if (toInput) { toInput.addEventListener("change", function () { validateDateRange(); }); }
        if (driverSelect) { driverSelect.addEventListener("change", function () { validateDateRange(); }); }

        if (csvBtn) {
            csvBtn.addEventListener("click", function () {
                HLA.AuditTable.exportCSV();
            });
        }

        HLA.AuditTable.bindSort();
    }

    // -- Mock data for standalone preview --------------------------

    function buildMockApi() {
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
            // Active original record
            { id: "log1", state: "Active", status: "D", dateTime: hoursAgo(48), driver: {id: "u1"}, origin: "Automatic" },
            // Edit of log1 — changed from Driving to On Duty
            { id: "log2", state: "Inactive", status: "ON", dateTime: hoursAgo(48), editDateTime: hoursAgo(24),
              parentId: {id: "log1"}, driver: {id: "u1"}, editRequestedByUser: {id: "u5"},
              annotations: [{comment: "Driver was at dock, not driving"}], origin: "Manual" },
            // Another active record
            { id: "log3", state: "Active", status: "ON", dateTime: hoursAgo(72), driver: {id: "u1"}, origin: "Automatic" },
            // Change requested for log3
            { id: "log4", state: "Requested", status: "Off", dateTime: hoursAgo(72), editDateTime: hoursAgo(36),
              parentId: {id: "log3"}, driver: {id: "u1"}, editRequestedByUser: {id: "u1"},
              annotations: [{comment: "Was off duty, system logged incorrectly"}], origin: "Manual" },
            // Rejected edit
            { id: "log5", state: "Rejected", status: "SB", dateTime: hoursAgo(60), editDateTime: hoursAgo(12),
              parentId: {id: "log3"}, driver: {id: "u1"}, editRequestedByUser: {id: "u1"},
              annotations: [{comment: "No evidence of sleeper berth usage"}], origin: "Manual" },
            // Another edit chain for driver u2
            { id: "log6", state: "Active", status: "Off", dateTime: hoursAgo(30), driver: {id: "u2"}, origin: "Automatic" },
            { id: "log7", state: "Inactive", status: "ON", dateTime: hoursAgo(30), editDateTime: hoursAgo(10),
              parentId: {id: "log6"}, driver: {id: "u2"}, editRequestedByUser: {id: "u5"},
              annotations: [{comment: "Pre-trip inspection"}, {comment: "Confirmed by dispatch"}], origin: "Manual" },
            // Edit with no parent
            { id: "log8", state: "Inactive", status: "D", dateTime: hoursAgo(20), editDateTime: hoursAgo(5),
              driver: {id: "u1"}, editRequestedByUser: {id: "u5"},
              annotations: [], origin: "Manual" }
        ];

        return {
            multiCall: function (calls, success, failure) {
                var results = calls.map(function (call) {
                    var typeName = call[1].typeName;
                    var search = call[1].search || {};
                    switch (typeName) {
                        case "User":
                            if (search.isDriver) {
                                return mockDrivers.filter(function(d) { return d.isDriver; });
                            }
                            return mockDrivers;
                        case "DutyStatusLog":
                            // Filter logs by driver if specified
                            var driverId = search.userSearch ? search.userSearch.id : null;
                            if (driverId) {
                                return mockLogs.filter(function (l) {
                                    return l.driver && l.driver.id === driverId;
                                });
                            }
                            return mockLogs;
                        default:
                            return [];
                    }
                });
                setTimeout(function () { success(results); }, 300);
            }
        };
    }

    // -- Lifecycle -------------------------------------------------

    return {
        initialize: function (api, page, callback) {
            _api = api;
            _page = page;

            setDefaultDates();
            bindEvents();

            showLoading("Loading drivers\u2026");
            HLA.AuditService.loadDrivers(_api)
                .then(function (drivers) {
                    populateDrivers(drivers);
                    hideLoading();
                    validateDateRange();
                })
                .catch(function (err) {
                    showError("Failed to load drivers: " + (err.message || err));
                    console.error("HLA driver load error:", err);
                });

            if (callback) { callback(); }
        },

        focus: function (api, page) {
            _api = api;
            _page = page;
            var container = document.getElementById("hlaContainer");
            if (container) { container.style.display = "block"; }
        },

        blur: function () {
            var container = document.getElementById("hlaContainer");
            if (container) { container.style.display = "none"; }
        },

        _initStandalone: function () {
            _api = buildMockApi();
            _page = {};
            setDefaultDates();
            bindEvents();

            showLoading("Loading drivers\u2026");
            HLA.AuditService.loadDrivers(_api)
                .then(function (drivers) {
                    populateDrivers(drivers);
                    hideLoading();
                    validateDateRange();
                })
                .catch(function (err) {
                    showError("Failed to load drivers: " + (err.message || err));
                });
        }
    };
};

// Auto-start in standalone mode (no MyGeotab host)
(function () {
    if (typeof document === "undefined") { return; }

    function tryStandaloneInit() {
        if (typeof geotab.addin.hos_log_edit_audit === "function") {
            var addin = geotab.addin.hos_log_edit_audit();
            addin._initStandalone();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { setTimeout(tryStandaloneInit, 2000); });
    } else {
        setTimeout(tryStandaloneInit, 2000);
    }
})();
