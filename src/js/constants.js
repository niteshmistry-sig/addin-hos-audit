/**
 * constants.js — HOS Log Edit Audit constants and configuration.
 */
var HLA = HLA || {};

HLA.Constants = (function () {
    "use strict";

    var EventRecordStatus = {
        ACTIVE: "Active",
        INACTIVE_CHANGED: "Inactive",
        CHANGE_REQUESTED: "Requested",
        CHANGE_REJECTED: "Rejected"
    };

    var EventRecordStatusLabels = {};
    EventRecordStatusLabels[EventRecordStatus.ACTIVE] = "Active";
    EventRecordStatusLabels[EventRecordStatus.INACTIVE_CHANGED] = "Inactive (Changed)";
    EventRecordStatusLabels[EventRecordStatus.CHANGE_REQUESTED] = "Change Requested";
    EventRecordStatusLabels[EventRecordStatus.CHANGE_REJECTED] = "Change Rejected";

    var DutyStatusLabels = {
        "Off": "Off Duty",
        "ON": "On Duty",
        "SB": "Sleeper Berth",
        "D": "Driving",
        "OffDuty": "Off Duty",
        "SleeperBerth": "Sleeper Berth",
        "Driving": "Driving",
        "OnDuty": "On Duty",
        "PC": "Personal Conveyance",
        "YM": "Yard Move"
    };

    var MAX_DATE_RANGE_DAYS = 7;

    var ALL_STATUSES = [
        EventRecordStatus.ACTIVE,
        EventRecordStatus.INACTIVE_CHANGED,
        EventRecordStatus.CHANGE_REQUESTED,
        EventRecordStatus.CHANGE_REJECTED
    ];

    return {
        EventRecordStatus: EventRecordStatus,
        EventRecordStatusLabels: EventRecordStatusLabels,
        DutyStatusLabels: DutyStatusLabels,
        MAX_DATE_RANGE_DAYS: MAX_DATE_RANGE_DAYS,
        ALL_STATUSES: ALL_STATUSES
    };
})();
