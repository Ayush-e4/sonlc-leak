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
            autoReceive: true
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
            autoReceive: stored.autoReceive !== undefined ? Boolean(stored.autoReceive) : defaults.autoReceive
        };
    }

    function saveSettings(settings) {
        const normalized = {
            callsign: normalizeCallsign(settings.callsign),
            protocol: String(settings.protocol || '1'),
            autoReceive: Boolean(settings.autoReceive)
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
        const payload = `p|${encodeURIComponent(callsign)}|${nonce}|${encodeURIComponent(messageText)}`;

        return {
            payload,
            bytes: packetByteLength(payload),
            modeLabel: 'Open',
            nonce
        };
    }

    function unpackMessage(payload, settings) {
        const parts = String(payload || '').split('|');

        if (parts.length < 4 || parts[0] !== 'p') {
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
