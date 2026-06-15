(function () {
  'use strict';

  var BASE_URL = 'http://127.0.0.1:4821';
  var HEALTH_PATH = '/health';
  var CHECK_TTL_MS = 5000;
  var bridgeState = { checked: false, online: false, lastCheck: 0 };

  var nativeLocalStorage = (function () {
    var store = null;
    try { store = window.localStorage; } catch (_) { store = null; }
    return {
      store: store,
      getItem: store && typeof store.getItem === 'function' ? store.getItem.bind(store) : function () { return null; },
      setItem: store && typeof store.setItem === 'function' ? store.setItem.bind(store) : function () {},
      removeItem: store && typeof store.removeItem === 'function' ? store.removeItem.bind(store) : function () {},
      clear: store && typeof store.clear === 'function' ? store.clear.bind(store) : function () {},
      key: store && typeof store.key === 'function' ? store.key.bind(store) : function () { return null; },
      length: function () {
        try { return store ? Number(store.length || 0) : 0; } catch (_) { return 0; }
      }
    };
  })();

  function request(method, path, payload) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, BASE_URL + path, false);
    xhr.timeout = 800;
    if (payload != null) xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    xhr.send(payload != null ? JSON.stringify(payload) : null);
    if (xhr.status < 200 || xhr.status >= 300) throw new Error('HTTP ' + xhr.status);
    return xhr.responseText ? JSON.parse(xhr.responseText) : null;
  }

  function requestAsync(method, path, payload) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, BASE_URL + path, true);
      xhr.timeout = 12000;
      if (payload != null) xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
          } catch (err) {
            reject(err);
          }
          return;
        }
        reject(new Error('HTTP ' + xhr.status));
      };
      xhr.ontimeout = function () { reject(new Error('Timeout')); };
      xhr.onerror = function () { reject(new Error('Netzwerkfehler')); };
      xhr.send(payload != null ? JSON.stringify(payload) : null);
    });
  }

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer || new ArrayBuffer(0));
    var chunkSize = 0x8000;
    var binary = '';
    for (var i = 0; i < bytes.length; i += chunkSize) {
      var chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return window.btoa(binary);
  }

  function blobToBase64(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') {
      return Promise.reject(new Error('Blob kann nicht gelesen werden.'));
    }
    return blob.arrayBuffer().then(function (buffer) {
      return arrayBufferToBase64(buffer);
    });
  }

  function bridgeOnline() {
    var now = Date.now();
    if (bridgeState.checked && (now - bridgeState.lastCheck) < CHECK_TTL_MS) return bridgeState.online;
    bridgeState.checked = true;
    bridgeState.lastCheck = now;
    try {
      var data = request('GET', HEALTH_PATH, null);
      bridgeState.online = Boolean(data && data.ok);
    } catch (_) {
      bridgeState.online = false;
    }
    return bridgeState.online;
  }

  function fallbackGet(key) {
    try { return nativeLocalStorage.getItem(String(key || '')); } catch (_) { return null; }
  }

  function fallbackSet(key, value) {
    try { nativeLocalStorage.setItem(String(key || ''), String(value == null ? '' : value)); } catch (_) {}
  }

  function fallbackRemove(key) {
    try { nativeLocalStorage.removeItem(String(key || '')); } catch (_) {}
  }

  function fallbackKeys() {
    var out = [];
    try {
      for (var i = 0; i < nativeLocalStorage.length(); i += 1) {
        var key = nativeLocalStorage.key(i);
        if (key != null) out.push(String(key));
      }
    } catch (_) {}
    return out;
  }

  function buildFallbackSnapshot() {
    var keys = fallbackKeys();
    var entries = {};
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      entries[key] = fallbackGet(key);
    }
    return {
      kind: 'rechnungstool-snapshot-v1',
      capturedAt: new Date().toISOString(),
      revision: 0,
      updatedAt: null,
      keyCount: keys.length,
      entries: entries
    };
  }

  function syncFallbackSnapshot(snapshot) {
    if (!snapshot || !snapshot.entries || typeof snapshot.entries !== 'object') return snapshot;
    Object.keys(snapshot.entries).forEach(function (key) {
      var value = snapshot.entries[key];
      if (value == null) fallbackRemove(key);
      else fallbackSet(key, value);
    });
    return snapshot;
  }

  function emitStorageChange(action, key, value) {
    try {
      window.dispatchEvent(new CustomEvent('appstoragechange', {
        detail: {
          action: String(action || ''),
          key: key == null ? null : String(key),
          value: value == null ? null : String(value)
        }
      }));
    } catch (_) {}
  }

  function uniqueKeys(first, second) {
    var seen = Object.create(null);
    var out = [];
    [first, second].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (item) {
        var key = String(item || '');
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push(key);
      });
    });
    return out;
  }

  function getRemote(key) {
    var data = request('GET', '/storage/get?key=' + encodeURIComponent(String(key || '')), null);
    return data && Object.prototype.hasOwnProperty.call(data, 'value') ? data.value : null;
  }

  function setRemote(key, value) {
    request('POST', '/storage/set', { key: String(key || ''), value: String(value == null ? '' : value) });
  }

  function removeRemote(key) {
    request('POST', '/storage/remove', { key: String(key || '') });
  }

  function keysRemote() {
    var data = request('GET', '/storage/keys', null);
    return Array.isArray(data && data.keys) ? data.keys : [];
  }

  function infoRemote() {
    return request('GET', '/storage/info', null) || null;
  }

  function snapshotRemote() {
    return request('GET', '/storage/snapshot', null) || null;
  }

  function createDesktopStorage() {
    var desktop = window.desktopStorage;

    function migrateFallbackIfNeeded() {
      var keys = [];
      try { keys = Array.isArray(desktop.keys()) ? desktop.keys() : []; } catch (_) { keys = []; }
      if (keys.length) return keys;
      var localKeys = fallbackKeys();
      if (!localKeys.length) return [];
      for (var i = 0; i < localKeys.length; i += 1) {
        var key = localKeys[i];
        var value = fallbackGet(key);
        if (value == null) continue;
        try { desktop.setItem(key, value); } catch (_) {}
      }
      return localKeys;
    }

    return {
      getItem: function (key) {
        var k = String(key || '');
        try {
          var value = desktop.getItem(k);
          if (value != null) {
            fallbackSet(k, value);
            return value;
          }
        } catch (_) {}
        var localValue = fallbackGet(k);
        if (localValue != null) {
          try { desktop.setItem(k, localValue); } catch (_) {}
          return localValue;
        }
        return null;
      },
      setItem: function (key, value) {
        var k = String(key || '');
        var str = String(value == null ? '' : value);
        try { desktop.setItem(k, str); } catch (_) {}
        fallbackSet(k, str);
        emitStorageChange('set', k, str);
      },
      removeItem: function (key) {
        var k = String(key || '');
        try { desktop.removeItem(k); } catch (_) {}
        fallbackRemove(k);
        emitStorageChange('remove', k, null);
      },
      key: function (index) {
        var keys = this.keys();
        return keys[Number(index)] || null;
      },
      clear: function () {
        var keys = this.keys();
        for (var i = 0; i < keys.length; i += 1) this.removeItem(keys[i]);
      },
      keys: function () {
        var migrated = migrateFallbackIfNeeded();
        if (migrated.length) return migrated;
        try {
          var keys = desktop.keys();
          if (Array.isArray(keys)) return keys;
        } catch (_) {}
        return fallbackKeys();
      },
      snapshot: function () {
        try {
          if (typeof desktop.snapshot === 'function') {
            return syncFallbackSnapshot(desktop.snapshot());
          }
        } catch (_) {}
        return buildFallbackSnapshot();
      },
      info: function () {
        try {
          var info = typeof window.desktopStorageInfo === 'function' ? window.desktopStorageInfo() : null;
          return info || { mode: 'electron-main-store' };
        } catch (_) {
          return { mode: 'electron-main-store' };
        }
      }
    };
  }

  function createBridgeStorage() {
    function migrateFallbackToRemoteIfNeeded() {
      if (!bridgeOnline()) return [];
      var remoteKeys = [];
      try { remoteKeys = keysRemote(); } catch (_) { remoteKeys = []; }
      if (remoteKeys.length) return remoteKeys;
      var localKeys = fallbackKeys();
      if (!localKeys.length) return [];
      for (var i = 0; i < localKeys.length; i += 1) {
        var key = localKeys[i];
        var value = fallbackGet(key);
        if (value == null) continue;
        try { setRemote(key, value); } catch (_) {}
      }
      return localKeys;
    }

    return {
      getItem: function (key) {
        var k = String(key || '');
        if (bridgeOnline()) {
          try {
            var value = getRemote(k);
            if (value != null) {
              fallbackSet(k, value);
              return value;
            }
          } catch (_) {}
        }
        return fallbackGet(k);
      },
      setItem: function (key, value) {
        var k = String(key || '');
        var str = String(value == null ? '' : value);
        if (bridgeOnline()) {
          try { setRemote(k, str); } catch (_) {}
        }
        fallbackSet(k, str);
        emitStorageChange('set', k, str);
      },
      removeItem: function (key) {
        var k = String(key || '');
        if (bridgeOnline()) {
          try { removeRemote(k); } catch (_) {}
        }
        fallbackRemove(k);
        emitStorageChange('remove', k, null);
      },
      key: function (index) {
        var keys = this.keys();
        return keys[Number(index)] || null;
      },
      clear: function () {
        var keys = this.keys();
        for (var i = 0; i < keys.length; i += 1) this.removeItem(keys[i]);
      },
      keys: function () {
        if (bridgeOnline()) {
          var migrated = migrateFallbackToRemoteIfNeeded();
          if (migrated.length) return migrated;
          try {
            var remote = keysRemote();
            if (Array.isArray(remote)) return remote;
          } catch (_) {}
        }
        return fallbackKeys();
      },
      snapshot: function () {
        if (bridgeOnline()) {
          try {
            return syncFallbackSnapshot(snapshotRemote());
          } catch (_) {}
        }
        return buildFallbackSnapshot();
      },
      info: function () {
        if (bridgeOnline()) {
          try {
            var info = infoRemote();
            if (info) {
              info.mode = info.mode || 'shared-bridge';
              info.bridgeOnline = true;
              return info;
            }
          } catch (_) {}
        }
        return {
          mode: 'local-browser',
          bridgeOnline: false,
          keyCount: fallbackKeys().length
        };
      }
    };
  }

  function patchLocalStorage(storageApi) {
    if (!nativeLocalStorage.store || !storageApi) return;

    var proxy = {
      getItem: function (key) {
        return storageApi.getItem(key);
      },
      setItem: function (key, value) {
        storageApi.setItem(key, value);
      },
      removeItem: function (key) {
        storageApi.removeItem(key);
      },
      clear: function () {
        storageApi.clear();
      },
      key: function (index) {
        return storageApi.key(index);
      }
    };

    Object.defineProperty(proxy, 'length', {
      get: function () {
        return storageApi.keys().length;
      }
    });

    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        enumerable: true,
        get: function () {
          return proxy;
        }
      });
      return;
    } catch (_) {}

    try { nativeLocalStorage.store.getItem = proxy.getItem; } catch (_) {}
    try { nativeLocalStorage.store.setItem = proxy.setItem; } catch (_) {}
    try { nativeLocalStorage.store.removeItem = proxy.removeItem; } catch (_) {}
    try { nativeLocalStorage.store.clear = proxy.clear; } catch (_) {}
    try { nativeLocalStorage.store.key = proxy.key; } catch (_) {}
    try {
      Object.defineProperty(nativeLocalStorage.store, 'length', {
        configurable: true,
        get: function () {
          return storageApi.keys().length;
        }
      });
    } catch (_) {}
  }

  function createExportFileApi() {
    var api = {
      save: function (payload) {
        var body = payload && typeof payload === 'object' ? payload : {};
        if (window.desktopFileApi && typeof window.desktopFileApi.saveExport === 'function') {
          try {
            return Promise.resolve(window.desktopFileApi.saveExport(body));
          } catch (err) {
            return Promise.reject(err);
          }
        }
        if (bridgeOnline()) return requestAsync('POST', '/exports/save', body);
        return Promise.resolve({ ok: false, skipped: true, reason: 'no-export-channel' });
      },
      saveBlob: function (fileName, blob, meta) {
        var details = meta && typeof meta === 'object' ? meta : {};
        return blobToBase64(blob).then(function (base64) {
          return api.save({
            fileName: fileName,
            base64: base64,
            mimeType: blob && blob.type ? String(blob.type) : '',
            format: details.format || '',
            source: details.source || 'blob-download',
            revision: details.revision,
            keyCount: details.keyCount
          });
        });
      },
      isAvailable: function () {
        return Boolean(
          (window.desktopFileApi && typeof window.desktopFileApi.saveExport === 'function')
          || bridgeOnline()
        );
      }
    };
    return api;
  }

  function shouldPersistDownload(fileName) {
    var lower = String(fileName || '').trim().toLowerCase();
    if (!lower) return false;
    return /\.(csv|xlsx|xls|json|pdf|pptx)$/i.test(lower);
  }

  function patchDownloadPersistence(exportApi) {
    if (!exportApi || !window.URL || !window.HTMLAnchorElement || !window.HTMLAnchorElement.prototype) return;

    var registry = Object.create(null);
    var originalCreate = typeof window.URL.createObjectURL === 'function'
      ? window.URL.createObjectURL.bind(window.URL)
      : null;
    var originalRevoke = typeof window.URL.revokeObjectURL === 'function'
      ? window.URL.revokeObjectURL.bind(window.URL)
      : null;
    var originalClick = typeof window.HTMLAnchorElement.prototype.click === 'function'
      ? window.HTMLAnchorElement.prototype.click
      : null;

    if (originalCreate) {
      window.URL.createObjectURL = function (object) {
        var url = originalCreate(object);
        try {
          if (object && typeof window.Blob !== 'undefined' && object instanceof window.Blob) registry[url] = object;
        } catch (_) {}
        return url;
      };
    }

    if (originalRevoke) {
      window.URL.revokeObjectURL = function (url) {
        try { delete registry[String(url || '')]; } catch (_) {}
        return originalRevoke(url);
      };
    }

    if (originalClick) {
      window.HTMLAnchorElement.prototype.click = function () {
        try {
          if (this.dataset && this.dataset.skipAutoSave === '1') return originalClick.apply(this, arguments);
          var fileName = String(this.download || '').trim();
          var href = String(this.href || this.getAttribute('href') || '').trim();
          var blob = registry[href];
          if (fileName && blob && shouldPersistDownload(fileName)) {
            exportApi.saveBlob(fileName, blob, { source: 'download-click' }).catch(function () {});
          }
        } catch (_) {}
        return originalClick.apply(this, arguments);
      };
    }
  }

  var storageApi = window.desktopStorage && typeof window.desktopStorage.getItem === 'function'
    ? createDesktopStorage()
    : createBridgeStorage();
  var exportFileApi = createExportFileApi();
  var EMERGENCY_EXCLUDED_RENTAL_IDS = {
    'VMBELEG-1773514516627': true,
    'VMBELEG-1773514242348': true,
    'VMBELEG-1773514169178': true,
    'VMBELEG-1773511188588': true,
    'VMBELEG-1773511160416': true,
    'VMBELEG-1773511036013': true,
    'VMBELEG-1773511035697': true,
    'VMBELEG-1773511034667': true,
    'VMBELEG-1773511033852': true,
    'VMBELEG-1773511032869': true,
    'VMBELEG-1773511025083': true,
    'VMBELEG-1773511022180': true,
    'VMBELEG-1773511020517': true
  };

  function readStorageSources(key) {
    var k = String(key || '');
    var appRaw = null;
    var localRaw = null;
    try {
      if (window.desktopStorage && typeof window.desktopStorage.getItem === 'function') {
        appRaw = window.desktopStorage.getItem(k);
      } else if (bridgeOnline()) {
        appRaw = getRemote(k);
      }
    } catch (_) { appRaw = null; }
    try { localRaw = fallbackGet(k); } catch (_) { localRaw = null; }
    return {
      appRaw: appRaw == null ? null : String(appRaw),
      localRaw: localRaw == null ? null : String(localRaw)
    };
  }

  function parseStoredArrayResult(raw) {
    if (raw == null) return { items: [], valid: false, explicitEmpty: false };
    var text = String(raw || '');
    if (!text.trim()) return { items: [], valid: false, explicitEmpty: false };
    try {
      var parsed = JSON.parse(text);
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch (_) {}
      }
      if (Array.isArray(parsed)) {
        return { items: parsed, valid: true, explicitEmpty: parsed.length === 0 };
      }
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.entries)) return { items: parsed.entries, valid: true, explicitEmpty: parsed.entries.length === 0 };
        if (Array.isArray(parsed.data)) return { items: parsed.data, valid: true, explicitEmpty: parsed.data.length === 0 };
        if (Array.isArray(parsed.items)) return { items: parsed.items, valid: true, explicitEmpty: parsed.items.length === 0 };
        if (Array.isArray(parsed.list)) return { items: parsed.list, valid: true, explicitEmpty: parsed.list.length === 0 };
      }
      return { items: [], valid: false, explicitEmpty: false };
    } catch (_) {
      return { items: [], valid: false, explicitEmpty: false };
    }
  }

  function loadCanonicalArraySnapshot(key, dedupeFn) {
    var sources = readStorageSources(key);
    var appParsed = parseStoredArrayResult(sources.appRaw);
    var localParsed = parseStoredArrayResult(sources.localRaw);
    var parsed = [];
    if (sources.appRaw != null) {
      if (appParsed.valid && appParsed.explicitEmpty) return [];
      parsed = appParsed.valid ? appParsed.items.concat(localParsed.items) : localParsed.items;
    } else {
      parsed = localParsed.items;
    }
    return typeof dedupeFn === 'function' ? dedupeFn(parsed) : parsed;
  }

  function isEmergencyExcludedRentalId(entry) {
    var id = String(entry && entry.id ? entry.id : '').trim();
    return !!id && !!EMERGENCY_EXCLUDED_RENTAL_IDS[id];
  }

  function latestAuditMarksEntryDeleted(entry) {
    var audits = Array.isArray(entry && entry.archivAudit) ? entry.archivAudit : [];
    var latest = null;
    var latestTs = -1;
    for (var i = 0; i < audits.length; i += 1) {
      var audit = audits[i];
      var ts = Date.parse(String(audit && audit.at ? audit.at : ''));
      var score = Number.isFinite(ts) ? ts : -1;
      if (score >= latestTs) {
        latest = audit;
        latestTs = score;
      }
    }
    if (!latest || !Array.isArray(latest.changes)) return false;
    var text = latest.changes.map(function (item) { return String(item || '').toLowerCase(); }).join(' ');
    return text.indexOf('deleted') >= 0 || text.indexOf('geloescht') >= 0 || text.indexOf('gelöscht') >= 0 || text.indexOf('storno') >= 0;
  }

  function isDeletedOrStornoRentalEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (isEmergencyExcludedRentalId(entry)) return true;
    var payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    var buch = payload._buchhaltung && typeof payload._buchhaltung === 'object' ? payload._buchhaltung : {};
    var meta = payload._meta && typeof payload._meta === 'object' ? payload._meta : {};
    if (entry.excludeFromAnalysis === true || payload.excludeFromAnalysis === true) return true;
    if (entry.isDeleted === true || meta.isDeleted === true) return true;
    if (latestAuditMarksEntryDeleted(entry)) return true;
    var statusText = [
      entry.status,
      entry.webhookStatus,
      payload.status,
      payload.webhookStatus,
      meta.status,
      meta.webhookStatus,
      buch.forderungsstatus,
      buch.rechnungsart
    ].map(function (value) { return String(value || '').toLowerCase(); }).join(' ');
    if (entry.deletedAt || meta.deletedAt || payload.deletedAt) return true;
    if (statusText.indexOf('deleted') >= 0 || statusText.indexOf('geloescht') >= 0 || statusText.indexOf('gelöscht') >= 0) return true;
    if (entry.storno === true || buch.storno === true || meta.storno === true) return true;
    var text = [
      entry.id,
      entry.bezeichnung,
      payload['Bezeichnung der Abrechnung'],
      payload['Bemerkung zur Abrechnung'],
      buch.buchungstext
    ].map(function (value) { return String(value || '').toLowerCase(); }).join(' ');
    if (String(entry.id || '').toLowerCase().indexOf('storno-') === 0) return true;
    return text.indexOf('storno zu buchung') >= 0 || text.indexOf('storno zu ') >= 0 || statusText.indexOf('storniert') >= 0 || statusText.indexOf('storno') >= 0;
  }

  function getRentalEntryTimestamp(entry) {
    if (!entry || typeof entry !== 'object') return 0;
    var payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    var meta = payload._meta && typeof payload._meta === 'object' ? payload._meta : {};
    var candidates = [
      entry.updatedAt,
      entry.deletedAt,
      entry.webhookSentAt,
      entry.createdAt,
      entry.datum,
      entry.rechnungsdatum,
      meta.updatedAt,
      meta.deletedAt,
      meta.createdAt
    ];
    var best = 0;
    for (var i = 0; i < candidates.length; i += 1) {
      var raw = String(candidates[i] || '').trim();
      if (!raw) continue;
      var ts = Date.parse(raw);
      if (Number.isFinite(ts) && ts > best) best = ts;
    }
    return best;
  }

  function dedupeLatestRentalEntries(entries) {
    var list = Array.isArray(entries) ? entries : [];
    var byId = {};
    var order = [];
    var withoutId = [];
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i];
      var id = String(row && row.id ? row.id : '').trim();
      if (!id) {
        withoutId.push(row);
        continue;
      }
      var prev = byId[id];
      if (!prev) {
        byId[id] = row;
        order.push(id);
        continue;
      }
      var prevTs = getRentalEntryTimestamp(prev);
      var nextTs = getRentalEntryTimestamp(row);
      if (nextTs > prevTs) {
        byId[id] = row;
        continue;
      }
      if (nextTs < prevTs) continue;
      var prevDeleted = isDeletedOrStornoRentalEntry(prev);
      var nextDeleted = isDeletedOrStornoRentalEntry(row);
      if (prevDeleted !== nextDeleted) {
        byId[id] = nextDeleted ? row : prev;
        continue;
      }
      if (String(row.createdAt || '') > String(prev.createdAt || '')) byId[id] = row;
    }
    return order.map(function (id) { return byId[id]; }).concat(withoutId);
  }

  function dedupeProjects(entries) {
    var list = Array.isArray(entries) ? entries : [];
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i] && typeof list[i] === 'object' ? list[i] : null;
      if (!row) continue;
      var id = String(row.id || '').trim();
      var name = String(row.name || '').trim().toLowerCase();
      var key = id || (name ? 'name:' + name : '');
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(row);
    }
    return out;
  }

  function getCanonicalRentalEntries() {
    return loadCanonicalArraySnapshot('vermietung_list_v1', dedupeLatestRentalEntries);
  }

  function getActiveRentalEntries() {
    return getCanonicalRentalEntries().filter(function (entry) {
      return !isDeletedOrStornoRentalEntry(entry);
    });
  }

  function getCanonicalProjects() {
    return loadCanonicalArraySnapshot('vermietung_project_list_v1', dedupeProjects);
  }

  function getRentalDisplayAmount(entry) {
    var payload = entry && entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    var buchhaltung = payload._buchhaltung && typeof payload._buchhaltung === 'object' ? payload._buchhaltung : {};
    var rawBetrag = entry && entry.betrag != null ? Math.abs(Number(entry.betrag)) : null;
    var candidates = [
      entry && entry.rechnungsbetragBrutto,
      payload['Rechnungsbetrag (Brutto)'],
      buchhaltung.brutto,
      entry && entry.betragAbs,
      rawBetrag
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var value = Number(candidates[i]);
      if (Number.isFinite(value) && Math.abs(value) > 0) return Number(value.toFixed(2));
    }
    for (var j = 0; j < candidates.length; j += 1) {
      var fallbackValue = Number(candidates[j]);
      if (Number.isFinite(fallbackValue)) return Number(fallbackValue.toFixed(2));
    }
    return 0;
  }

  window.appStorage = storageApi;
  window.appStorageInfo = function () {
    return storageApi.info();
  };
  window.exportFileApi = exportFileApi;
  window.appStorageTools = {
    readStorageSources: readStorageSources,
    parseStoredArrayResult: parseStoredArrayResult,
    loadCanonicalArraySnapshot: loadCanonicalArraySnapshot,
    isDeletedOrStornoRentalEntry: isDeletedOrStornoRentalEntry,
    getRentalEntryTimestamp: getRentalEntryTimestamp,
    dedupeLatestRentalEntries: dedupeLatestRentalEntries,
    dedupeProjects: dedupeProjects,
    getCanonicalRentalEntries: getCanonicalRentalEntries,
    getActiveRentalEntries: getActiveRentalEntries,
    getCanonicalProjects: getCanonicalProjects,
    getRentalDisplayAmount: getRentalDisplayAmount
  };

  window.appStorageTools = window.appStorageTools || {};

  window.appStorageTools.isEmergencyExcludedId = function(entry) {
    var emergencyExcludedRentalIds = new Set([
      'VMBELEG-1773514516627',
      'VMBELEG-1773514242348',
      'VMBELEG-1773514169178',
      'VMBELEG-1773511188588',
      'VMBELEG-1773511160416',
      'VMBELEG-1773511036013',
      'VMBELEG-1773511035697',
      'VMBELEG-1773511034667',
      'VMBELEG-1773511033852',
      'VMBELEG-1773511032869',
      'VMBELEG-1773511025083',
      'VMBELEG-1773511022180',
      'VMBELEG-1773511020517'
    ]);
    if (!entry || typeof entry !== 'object') return false;
    var payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    var candidates = [
      entry.id,
      entry.sourceId,
      entry.referenceId,
      entry.originalId,
      entry.referenz,
      payload.id,
      payload.sourceId,
      payload.referenceId,
      payload.originalId,
      payload.referenz
    ];
    return candidates.some(function(value) {
      return emergencyExcludedRentalIds.has(String(value || '').trim().toUpperCase());
    });
  };

  window.appStorageTools.latestAuditMarksDeleted = function(entry) {
    var audits = Array.isArray(entry && entry.archivAudit) ? entry.archivAudit : [];
    if (!audits.length) return false;
    var latest = null;
    var latestTs = -1;
    audits.forEach(function(item) {
      if (!item || typeof item !== 'object') return;
      var ts = Date.parse(String(item.at || item.updatedAt || item.createdAt || ''));
      var score = Number.isFinite(ts) ? ts : -1;
      if (latest == null || score > latestTs) {
        latest = item;
        latestTs = score;
      }
    });
    if (latest == null) latest = audits[0] && typeof audits[0] === 'object' ? audits[0] : null;
    var changes = Array.isArray(latest && latest.changes) ? latest.changes : [];
    if (!changes.length) return false;
    var joined = changes.map(function(v) { return String(v || '').toLowerCase(); }).join(' | ');
    if (joined.includes('-> deleted')) return true;
    if (joined.includes('-> storno')) return true;
    if (joined.includes('-> storniert')) return true;
    if (joined.includes('deletedat:') && !joined.includes('deletedat:  -> -') && !joined.includes('deletedat: - -> -')) return true;
    return false;
  };

  window.appStorageTools.isDeletedOrStorno = function(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (this.isEmergencyExcludedId(entry)) return true;
    var payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    var buch = payload._buchhaltung && typeof payload._buchhaltung === 'object' ? payload._buchhaltung : {};
    var meta = payload._meta && typeof payload._meta === 'object' ? payload._meta : {};
    if (entry.isDeleted === true || meta.isDeleted === true) return true;
    if (this.latestAuditMarksDeleted(entry)) return true;
    var statusText = [
      entry.status,
      entry.webhookStatus,
      payload.status,
      payload.webhookStatus,
      meta.status,
      meta.webhookStatus,
      buch.forderungsstatus,
      buch.rechnungsart
    ].map(function(v) { return String(v || '').toLowerCase(); }).join(' ');
    if (Boolean(entry.deletedAt) || Boolean(meta.deletedAt) || Boolean(payload.deletedAt)) return true;
    if (statusText.includes('deleted') || statusText.includes('geloescht') || statusText.includes('gelöscht')) return true;
    if (entry.storno === true || buch.storno === true || meta.storno === true) return true;
    var text = [
      entry.id,
      entry.bezeichnung,
      payload['Bezeichnung der Abrechnung'],
      payload['Bemerkung zur Abrechnung'],
      buch.buchungstext
    ].map(function(v) { return String(v || '').toLowerCase(); }).join(' ');
    if (String(entry.id || '').toLowerCase().startsWith('storno-')) return true;
    return text.includes('storno zu buchung') || text.includes('storno zu ') || statusText.includes('storniert') || statusText.includes('storno');
  };

  window.appStorageTools.isAnalyticsRelevant = function(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (this.isEmergencyExcludedId(entry)) return false;
    var payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    var buch = payload._buchhaltung && typeof payload._buchhaltung === 'object' ? payload._buchhaltung : {};
    var meta = payload._meta && typeof payload._meta === 'object' ? payload._meta : {};
    if (entry.excludeFromAnalysis === true || payload.excludeFromAnalysis === true) return false;
    if (entry.isDeleted === true || meta.isDeleted === true) return false;
    if (this.latestAuditMarksDeleted(entry)) return false;
    var statusText = [
      entry.status,
      entry.webhookStatus,
      payload.status,
      payload.webhookStatus,
      meta.status,
      meta.webhookStatus,
      buch.forderungsstatus,
      buch.rechnungsart
    ].map(function(v) { return String(v || '').toLowerCase(); }).join(' ');
    if (Boolean(entry.deletedAt) || Boolean(meta.deletedAt) || Boolean(payload.deletedAt) || statusText.includes('deleted') || statusText.includes('geloescht') || statusText.includes('gelöscht')) {
      return false;
    }
    if (entry.storno === true || buch.storno === true || meta.storno === true) return false;
    var text = [
      entry.id,
      entry.bezeichnung,
      payload['Bezeichnung der Abrechnung'],
      payload['Bemerkung zur Abrechnung'],
      buch.buchungstext
    ].map(function(v) { return String(v || '').toLowerCase(); }).join(' ');
    if (String(entry.id || '').toLowerCase().startsWith('storno-')) return false;
    if (text.includes('storno zu buchung') || text.includes('storno zu ') || statusText.includes('storniert') || statusText.includes('storno')) return false;
    return true;
  };

  Object.defineProperty(window.appStorage, 'length', {
    get: function () {
      return window.appStorage.keys().length;
    }
  });

  patchLocalStorage(storageApi);
  patchDownloadPersistence(exportFileApi);

  window.mailApi = {
    send: function (payload) {
      if (!bridgeOnline()) return Promise.reject(new Error('Bridge nicht erreichbar.'));
      return requestAsync('POST', '/mail/send', payload || {});
    },
    isAvailable: function () {
      return bridgeOnline();
    }
  };
})();
