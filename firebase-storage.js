(function (global) {
    'use strict';

    if (global.FirebaseConnectionStorage) return;
    const BUILD_ID = '20261029-release-2026102909';
    const BUILD_NUMBER = 2026102909;
    const hosts = new Set();
    const connectionValues = new Map();
    let installed = false;
    let storageWriteFailed = false;

    function isConnectionKey(key) {
        return key === 'firebase:sentinel'
            || key === 'firebase:previous_websocket_failure'
            || (key.startsWith('firebase:host:') && hosts.has(key.slice('firebase:host:'.length)));
    }

    try {
        const storage = global.localStorage;
        const prototype = global.Storage?.prototype;
        if (storage && prototype) {
            const getItem = prototype.getItem;
            const setItem = prototype.setItem;
            const removeItem = prototype.removeItem;
            // Only Firebase's connection metadata uses RAM. Application data,
            // backups, other Firebase projects and sessionStorage stay native.
            Object.defineProperties(prototype, {
                getItem: {
                    ...Object.getOwnPropertyDescriptor(prototype, 'getItem'),
                    value: function (key) {
                        if (installed && this === storage && isConnectionKey(String(key))) {
                            return connectionValues.get(String(key)) ?? null;
                        }
                        return getItem.apply(this, arguments);
                    }
                },
                setItem: {
                    ...Object.getOwnPropertyDescriptor(prototype, 'setItem'),
                    value: function (key, value) {
                        if (installed && this === storage && isConnectionKey(String(key))) {
                            connectionValues.set(String(key), String(value));
                            return;
                        }
                        return setItem.apply(this, arguments);
                    }
                },
                removeItem: {
                    ...Object.getOwnPropertyDescriptor(prototype, 'removeItem'),
                    value: function (key) {
                        if (installed && this === storage && isConnectionKey(String(key))) {
                            connectionValues.delete(String(key));
                            return;
                        }
                        return removeItem.apply(this, arguments);
                    }
                }
            });
            installed = true;
        }
    } catch (error) {
        console.warn('Firebase connection storage could not be isolated:', error);
    }

    function prepare(config) {
        try {
            const url = new URL(config.databaseURL);
            if (!/(?:^|\.)(?:firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname)) return false;
            hosts.add(url.hostname.toLowerCase());
            return installed;
        } catch (error) {
            return false;
        }
    }

    function noteStorageFailure(error) {
        if (error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
            || error?.code === 22 || error?.code === 1014) storageWriteFailed = true;
    }

    global.FirebaseConnectionStorage = {
        BUILD_ID,
        BUILD_NUMBER,
        prepare,
        noteStorageFailure,
        getStatus: () => ({ mode: installed ? 'memory' : 'unavailable', storageWriteFailed })
    };
})(window);
