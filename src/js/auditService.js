/**
 * auditService.js — API layer for loading drivers and fetching DutyStatusLog data.
 */
var HLA = HLA || {};

HLA.AuditService = (function () {
    "use strict";

    /**
     * Load all drivers (users with isDriver flag).
     * @param {Object} api - MyGeotab API object
     * @returns {Promise<Object[]>} Array of user objects
     */
    function loadDrivers(api) {
        return new Promise(function (resolve, reject) {
            api.multiCall([
                ["Get", {
                    typeName: "User",
                    search: { isDriver: true },
                    resultsLimit: 50000
                }]
            ], function (results) {
                resolve(results[0]);
            }, function (err) {
                reject(err);
            });
        });
    }

    /**
     * Fetch audit data: DutyStatusLogs with modifications + all users for name resolution.
     * @param {Object} api - MyGeotab API object
     * @param {string} driverId - User ID of the driver
     * @param {string} fromDate - ISO date string
     * @param {string} toDate - ISO date string
     * @returns {Promise<{logs: Object[], users: Object[]}>}
     */
    function fetchAuditData(api, driverId, fromDate, toDate) {
        return new Promise(function (resolve, reject) {
            api.multiCall([
                ["Get", {
                    typeName: "DutyStatusLog",
                    search: {
                        userSearch: { id: driverId },
                        fromDate: fromDate,
                        toDate: toDate,
                        statuses: HLA.Constants.ALL_STATUSES,
                        includeModifications: true
                    },
                    resultsLimit: 25000
                }],
                ["Get", {
                    typeName: "User",
                    resultsLimit: 50000
                }]
            ], function (results) {
                resolve({
                    logs: results[0],
                    users: results[1]
                });
            }, function (err) {
                reject(err);
            });
        });
    }

    return {
        loadDrivers: loadDrivers,
        fetchAuditData: fetchAuditData
    };
})();
