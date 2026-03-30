(function () {
    const SETTINGS_KEY = 'sonic-link.settings.v3';
    const MAX_PACKET_BYTES = 140;
    const PROTOCOL_LABELS = {
        '0': 'Audible Normal',
        '1': 'Audible Fast',
        '3': 'Ultrasound Normal',
        '4': 'Ultrasound Fast'
    };

    function safeDecodeURIComponent(value) {
        try {
            return decodeURIComponent(value);
        } catch (error) {
            return value;
        }
    }

    function textToBytes(text) {
        return new TextEncoder().encode(text);
    }

    function bytesToText(bytes) {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }

    function bytesToBase64(bytes) {
        let binary = '';

        for (let i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]);
        }

        return btoa(binary);
    }

    function base64ToBytes(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }

        return bytes;
    }

    function xorBytes(bytes, key) {
        const keyBytes = textToBytes(key);
        const out = new Uint8Array(bytes.length);

        for (let i = 0; i < bytes.length; i += 1) {
            out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
        }

        return out;
    }

    function encryptText(text, key) {
        return bytesToBase64(xorBytes(textToBytes(text), key));
    }

    function decryptText(cipherText, key) {
        return bytesToText(xorBytes(base64ToBytes(cipherText), key));
    }

    function makeNonce() {
        const bytes = new Uint8Array(4);

        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(bytes);
        } else {
            for (let i = 0; i < bytes.length; i += 1) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }

        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    function formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function normalizeCallsign(value) {
        const cleaned = (value || '')
            .replace(/[|\n\r]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 16);

        return cleaned || `Ghost-${Math.floor(100 + Math.random() * 900)}`;
    }

    function defaultSettings() {
        return {
            callsign: normalizeCallsign(''),
            protocol: '1',
            cryptic: true,
            secret: ''
        };
    }

    function loadSettings() {
        let stored = {};

        try {
            stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
        } catch (error) {
            stored = {};
        }

        const defaults = defaultSettings();

        return {
            callsign: normalizeCallsign(stored.callsign || defaults.callsign),
            protocol: String(stored.protocol || defaults.protocol),
            cryptic: stored.cryptic !== false,
            secret: typeof stored.secret === 'string' ? stored.secret.slice(0, 32) : defaults.secret
        };
    }

    function saveSettings(settings) {
        const normalized = {
            callsign: normalizeCallsign(settings.callsign),
            protocol: String(settings.protocol || '1'),
            cryptic: Boolean(settings.cryptic),
            secret: (settings.secret || '').slice(0, 32)
        };

        localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
        return normalized;
    }

    function hasSavedSettings() {
        try {
            return Boolean(localStorage.getItem(SETTINGS_KEY));
        } catch (error) {
            return false;
        }
    }

    function getProtocolLabel(protocol) {
        return PROTOCOL_LABELS[String(protocol)] || 'Audible Fast';
    }

    function packetByteLength(payload) {
        return textToBytes(payload).length;
    }

    function packMessage(text, settings) {
        const messageText = (text || '').trim();
        const callsign = normalizeCallsign(settings.callsign);
        const nonce = makeNonce();
        let payload = '';

        if (settings.cryptic) {
            if (!settings.secret) {
                throw new Error('Add the same passphrase on both devices for cryptic mode');
            }

            payload = `c|${encodeURIComponent(callsign)}|${nonce}|${encryptText(messageText, settings.secret)}`;
        } else {
            payload = `p|${encodeURIComponent(callsign)}|${nonce}|${encodeURIComponent(messageText)}`;
        }

        return {
            payload,
            bytes: packetByteLength(payload),
            modeLabel: settings.cryptic ? 'Cryptic' : 'Open',
            nonce
        };
    }

    function unpackMessage(payload, settings) {
        const parts = String(payload || '').split('|');

        if (parts.length < 4 || !['p', 'c'].includes(parts[0])) {
            return {
                from: 'Open Signal',
                text: payload,
                locked: false,
                modeLabel: 'Raw',
                signature: payload,
                ts: Date.now()
            };
        }

        const mode = parts[0];
        const rawFrom = parts[1];
        const nonce = parts[2];
        const body = parts.slice(3).join('|');
        const from = safeDecodeURIComponent(rawFrom) || 'Unknown';

        if (mode === 'c') {
            if (!settings.secret) {
                return {
                    from,
                    text: 'Locked packet received. Enter the same passphrase on both devices to decode it.',
                    locked: true,
                    modeLabel: 'Locked',
                    signature: `${nonce}:${rawFrom}`,
                    ts: Date.now()
                };
            }

            try {
                return {
                    from,
                    text: decryptText(body, settings.secret),
                    locked: false,
                    modeLabel: 'Cryptic',
                    signature: `${nonce}:${rawFrom}`,
                    ts: Date.now()
                };
            } catch (error) {
                return {
                    from,
                    text: 'Passphrase mismatch. Update setup so both devices use the same key.',
                    locked: true,
                    modeLabel: 'Locked',
                    signature: `${nonce}:${rawFrom}`,
                    ts: Date.now()
                };
            }
        }

        return {
            from,
            text: safeDecodeURIComponent(body),
            locked: false,
            modeLabel: 'Open',
            signature: `${nonce}:${rawFrom}`,
            ts: Date.now()
        };
    }

    window.SonicLink = {
        MAX_PACKET_BYTES,
        defaultSettings,
        loadSettings,
        saveSettings,
        hasSavedSettings,
        getProtocolLabel,
        formatTime,
        packetByteLength,
        packMessage,
        unpackMessage
    };
})();
