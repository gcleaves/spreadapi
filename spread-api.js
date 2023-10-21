/*
 * SpreadAPI 1.0, created by Mateusz Zieliński
 * Home page: https://spreadapi.com
 * Sponsored by: https://roombelt.com
 * License: Apache 2.0
 */

// Admin account that has read/write access to all sheets
User("admin", "PUT_STRONG_PASSWORD_HERE", ALL);

// User account that can add entries to the "transactions" sheet
// User("user", "Passw0rd!", { transactions: POST });

// User account that can add entries to the "transactions" sheet and read from "summary"
// User("user", "Passw0rd!", { transactions: POST, summary: GET });

// Anonymous account that has write access to a specified sheet
// User("anonymous", UNSAFE(""), { transactions: POST });

// Anonymous account that has read/write access to all sheets (NOT RECOMMENDED!)
// User("anonymous", UNSAFE(""), ALL);

// Anonymous account that has read access to all sheets (NOT RECOMMENDED!)
// User("anonymous", UNSAFE(""), GET);

/*
 * Copyright 2019 Mateusz Zieliński
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
 * FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/* Complete source code of the REST API can be found below */

/**
 * @OnlyCurrentDoc
 */

function doPost(request) {
  try {
    var requestData = JSON.parse(request.postData.contents);
  } catch (e) {
    return httpResponse(
      error(400, "invalid_post_payload", {
        payload: request.postData.contents,
        type: request.postData.type
      })
    );
  }

  if (Array.isArray(requestData)) {
    return httpResponse(requestData.map(handleRequest));
  }

  return httpResponse(handleRequest(requestData));
}

function handleRequest(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheetName = (params.sheet || "").toLowerCase();
  const _id = params.id == null ? null : +params.id;
  const method = (params["method"] || "GET").toUpperCase();
  const key = params.key || "";

  if (!hasAccess(key, sheetName, method)) {
    return error(401, "unauthorized", {});
  }

  if (!isStrongKey(key)) {
    return error(401, "weak_key", {
      message:
        "Authentication key should be at least 8 characters long " +
        "and contain at least one lower case, upper case, number and special character. " +
        "Update your password or mark it as UNSAFE. Refer to the documentation for details."
    });
  }

  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    return error(404, "sheet_not_found", { sheet: sheetName });
  }

  if (_id != null && _id <= 1) {
    return error(400, "row_index_invalid", { _id: _id });
  }

  const payload = params["payload"];

  switch (method) {
    case "GET":
      return _id != null
        ? handleGetSingleRow(sheet, _id)
        : handleGetMultipleRows(sheet, params);
    case "POST":
      return handlePost(sheet, payload);
    case "PUT":
      return handlePut(sheet, payload);
    case "DELETE":
      return handleDelete(sheet, _id);
    default:
      return error(404, "unknown_method", { method: method });
  }
}

function handleGetSingleRow(sheet, _id) {
  const lastColumn = sheet.getLastColumn();
  const headers = getHeaders(sheet);

  const rowData = sheet.getRange(_id, 1, 1, lastColumn).getValues()[0];
  const result = mapRowToObject(rowData, _id, headers);

  if (!result) {
    return error(404, "row_not_found", { _id: _id });
  }

  return data(200, result);
}

function handleGetMultipleRows(sheet, params) {
  const lastColumn = sheet.getLastColumn();
  const headers = getHeaders(sheet);

  const firstRow = 2;
  const lastRow = sheet.getLastRow();
  const total = Math.max(lastRow - firstRow + 1, 0);
  const limit = params.limit != null ? +params.limit : total;

  const isAsc =
    typeof params.order !== "string" || params.order.toLowerCase() !== "desc";

  if (isNaN(limit) || limit < 0) {
    return error(404, "invalid_limit", { limit: limit });
  }

  var firstRowInPage = isAsc ? firstRow : lastRow - limit + 1;
  if (params.start_id != null) {
    const start_id = +params.start_id;

    if (start_id < firstRow || start_id > lastRow) {
      return error(404, "start_id_out_of_range", { start_id: start_id });
    }

    firstRowInPage = start_id - (isAsc ? 0 : limit - 1);
  }

  const lastRowInPage = Math.min(firstRowInPage + limit - 1, lastRow);
  firstRowInPage = Math.max(firstRowInPage, firstRow);

  if (firstRowInPage > lastRowInPage) {
    return data(200, []);
  }

  const rows = sheet
    .getRange(firstRowInPage, 1, lastRowInPage - firstRowInPage + 1, lastColumn)
    .getValues()
    .map(function(item, index) {
      return mapRowToObject(item, firstRowInPage + index, headers);
    });

  if (!isAsc) {
    rows.reverse();
  }

  var next = isAsc ? lastRowInPage + 1 : firstRowInPage - 1;
  if (next < firstRow || next > lastRow) next = undefined;

  return data(200, rows.filter(isTruthy), { next: next });
}

function handlePost(sheet, payload) {
  const row = mapObjectToRow(payload, getHeaders(sheet));
  sheet.appendRow(row);
  return data(201);
}

/***
 * Update one or more rows
 * @param {Sheet} sheet - A Google Sheet object
 * @param {Object | [Object]} payload - Don't forget the _id key
 * @returns {{data, status}}
 */
function handlePut(sheet, payload) {
  let payloadArray;
  if(!Array.isArray(payload)) {
    payloadArray = [payload];
  } else {
    payloadArray = payload
  }

  // Check for missing _id
  for(const [idx, p] of payloadArray.entries()) {
    if(p._id==null) {
      return error(400, "row_id_missing", {index: idx});
    }
  }

  const headers = getHeaders(sheet);
  for(const p of payloadArray) {
    const _id = p._id;
    for (const [key, value] of Object.entries(p)) {
      const idx = headers.findIndex(h => h===key);
      if(idx===-1) continue;

      sheet.getRange(_id, idx+1, 1).setValue(value);
    }
  }

  return data(201);
}

function handleDelete(sheet, _id) {
  sheet.getRange("$" + _id + ":" + "$" + _id).setValue("");
  return data(204);
}

// HTTP utils

function httpResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function error(status, code, details) {
  return {
    status: status,
    error: { code: code, details: details }
  };
}

function data(status, data, params) {
  params = params || {};
  const result = { status: status, data: data };
  for (var key in params) {
    if (params.hasOwnProperty(key)) {
      result[key] = params[key];
    }
  }
  return result;
}

// Utils

function getHeaders(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = headers.length - 1; i >= 0; i--) {
    if (!isEmpty(headers[i])) return headers.slice(0, i + 1);
  }
  return [];
}

function isTruthy(x) {
  return !!x;
}

function isEmpty(item) {
  return item === "" || item == null;
}

function find(array, predicate) {
  if (!Array.isArray(array)) return;

  for (var i = 0; i < array.length; i++) {
    if (predicate(array[i])) {
      return array[i];
    }
  }
}

function mapObjectToRow(object, headers) {
  return headers.map(function(column) {
    if (isEmpty(column)) return "";
    if (object[column] === undefined) return "";
    return object[column];
  });
}

function mapRowToObject(row, _id, headers) {
  if (row.every(isEmpty)) {
    return null;
  }

  const result = { _id: _id };
  for (var i = 0; i < headers.length; i++) {
    if (!isEmpty(headers[i])) {
      result[headers[i]] = row[i];
    }
  }
  return result;
}

// Permissions & security

var users;
function User(name, key, permissions) {
  if (!users) {
    users = [];
  }
  users.push({ name: name, key: key, permissions: permissions });
}

function getUserWithKey(key) {
  return find(users, function(x) {
    return x.key === key || (typeof x === "object" && x.key.__unsafe === key);
  });
}

function isStrongKey(key) {
  const strongKeyRegex = new RegExp(
    "^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[\x20-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E])(?=.{8,})"
  );
  const user = getUserWithKey(key);

  if (!user) return false;
  if (user.key.__unsafe === key) return true;

  return user.key.match(strongKeyRegex);
}

function getPermissions(user, spreadsheet) {
  if (Array.isArray(user.permissions)) return user.permissions;
  if (typeof user.permissions === "function") return user.permissions;

  const keys = Object.keys(user.permissions);

  for(var i = 0; i < keys.length; i++) {
    if(keys[i].toLowerCase() === spreadsheet.toLowerCase()) {
      return user.permissions[keys[i]];
    }
  }

  return user.permissions["ALL"];
}

function hasAccess(key, spreadsheet, method) {
  const user = getUserWithKey(key);

  if (!user) return false;
  const permission = getPermissions(user, spreadsheet);
  if (!permission) return false;

  return !!(
    permission === ALL ||
    permission.toString() === method ||
    find(permission, function(x) {
      return x === ALL;
    }) ||
    find(permission, function(x) {
      return x.toString() === method;
    })
  );
}

function GET() {}
function POST() {}
function PUT() {}
function DELETE() {}
function ALL() {}
function UNSAFE(key) {
  return { __unsafe: key };
}

GET.toString = function() {
  return "GET";
};
POST.toString = function() {
  return "POST";
};
PUT.toString = function() {
  return "PUT";
};
DELETE.toString = function() {
  return "DELETE";
};
ALL.toString = function() {
  return "*";
};
