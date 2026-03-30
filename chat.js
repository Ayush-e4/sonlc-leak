document.addEventListener('DOMContentLoaded', () => {
    if (!window.SonicLink.hasSavedSettings()) {
        window.location.href = 'index.html';
        return;
    }

    window.AudioContext = window.AudioContext || window.webkitAudioContext;

    const callsignBadge = document.getElementById('callsignBadge');
    const protocolBadge = document.getElementById('protocolBadge');
    const modeBadge = document.getElementById('modeBadge');
    const byteMeter = document.getElementById('byteMeter');
    const hzDisplay = document.getElementById('hzDisplay');
    const receiverHint = document.getElementById('receiverHint');
    const messageCount = document.getElementById('messageCount');
    const chatFeed = document.getElementById('chatFeed');
    const emptyState = document.getElementById('emptyState');
    const composeInput = document.getElementById('composeInput');
    const composeHint = document.getElementById('composeHint');
    const txBtn = document.getElementById('txBtn');
    const rxBtn = document.getElementById('rxBtn');
    const clearBtn = document.getElementById('clearBtn');
    const statusEl = document.getElementById('status');

    if (!callsignBadge || !protocolBadge || !modeBadge || !byteMeter || !hzDisplay || !receiverHint || !messageCount || !chatFeed || !emptyState || !composeInput || !composeHint || !txBtn || !rxBtn || !clearBtn || !statusEl) {
        return;
    }

    let settings = window.SonicLink.loadSettings();
    let ggwaveModule = null;
    let ggwaveInstance = null;
    let audioCtx = null;
    let analyser = null;
    let mediaStream = null;
    let mediaSource = null;
    let recorder = null;
    let isListening = false;
    let restartReceiverAfterSend = false;

    const recentPackets = new Map();

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function convertTypedArray(src, Type) {
        const buffer = new ArrayBuffer(src.byteLength);
        new src.constructor(buffer).set(src);
        return new Type(buffer);
    }

    function applySettings() {
        settings = window.SonicLink.loadSettings();
        callsignBadge.textContent = settings.callsign;
        protocolBadge.textContent = window.SonicLink.getProtocolLabel(settings.protocol);
        modeBadge.textContent = 'Open Chat';
        composeHint.textContent = 'Shorter messages travel better and leave more room under the packet limit.';
        updateDraftMeter();
    }

    function updateDraftMeter() {
        const text = composeInput.value.trim();

        if (!text) {
            byteMeter.textContent = `0 / ${window.SonicLink.MAX_PACKET_BYTES} bytes`;
            return;
        }

        try {
            const packed = window.SonicLink.packMessage(text, settings);
            byteMeter.textContent = `${packed.bytes} / ${window.SonicLink.MAX_PACKET_BYTES} bytes`;
        } catch (error) {
            byteMeter.textContent = error.message;
        }
    }

    function updateMessageCount() {
        const count = chatFeed.querySelectorAll('[data-message-row]').length;
        messageCount.textContent = `${count} ${count === 1 ? 'packet' : 'packets'}`;
    }

    function clearTranscript() {
        chatFeed.innerHTML = '';
        chatFeed.appendChild(emptyState);
        emptyState.hidden = false;
        updateMessageCount();
        setStatus('Transcript cleared');
    }

    function markPacketSeen(signature) {
        const now = Date.now();

        for (const [key, time] of recentPackets.entries()) {
            if (now - time > 7000) {
                recentPackets.delete(key);
            }
        }

        if (recentPackets.has(signature)) {
            return true;
        }

        recentPackets.set(signature, now);
        return false;
    }

    function renderMessage(message, direction) {
        emptyState.hidden = true;

        const row = document.createElement('div');
        row.dataset.messageRow = 'true';
        row.className = `message-row ${direction}`;

        const bubble = document.createElement('article');
        bubble.className = `bubble ${direction === 'outgoing' ? 'bubble-self' : message.locked ? 'bubble-locked' : ''}`;

        const meta = document.createElement('div');
        meta.className = 'bubble-meta';
        meta.textContent = `${direction === 'outgoing' ? 'You' : message.from} • ${window.SonicLink.formatTime(message.ts)} • ${message.modeLabel}`;

        const body = document.createElement('p');
        body.className = 'bubble-body';
        body.textContent = message.text;

        bubble.append(meta, body);
        row.appendChild(bubble);
        chatFeed.appendChild(row);
        chatFeed.scrollTop = chatFeed.scrollHeight;
        updateMessageCount();
    }

    function updateBandLabel() {
        const limit = ((audioCtx ? audioCtx.sampleRate : 48000) / 2000).toFixed(1);
        hzDisplay.textContent = `0Hz - ${limit}kHz`;
    }

    const ggwaveReady = ggwave_factory({
        locateFile: (path) => path.endsWith('.wasm')
            ? 'https://cdn.jsdelivr.net/gh/ggerganov/ggwave/bindings/javascript/ggwave.wasm'
            : path
    }).then((obj) => {
        ggwaveModule = obj;
        setStatus('Tap Send Pulse or Start Listening to initialize audio');
    }).catch((error) => {
        setStatus(`Engine load failed: ${error.message}`);
        throw error;
    });

    async function initEngine() {
        await ggwaveReady;

        if (!audioCtx) {
            audioCtx = new AudioContext({ sampleRate: 48000 });
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.75;
            updateBandLabel();
            drawSpectrum();
        }

        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        if (!ggwaveInstance) {
            const parameters = ggwaveModule.getDefaultParameters();
            parameters.sampleRateInp = audioCtx.sampleRate;
            parameters.sampleRateOut = audioCtx.sampleRate;
            ggwaveInstance = ggwaveModule.init(parameters);
        }

        updateBandLabel();
        setStatus(`Engine ready @ ${audioCtx.sampleRate} Hz`);
    }

    async function startReceiver() {
        if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Mic capture needs HTTPS or localhost');
        }

        await initEngine();

        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false
            }
        });

        mediaSource = audioCtx.createMediaStreamSource(mediaStream);
        recorder = audioCtx.createScriptProcessor(1024, 1, 1);

        recorder.onaudioprocess = (event) => {
            const channelData = event.inputBuffer.getChannelData(0);
            const input = convertTypedArray(new Float32Array(channelData), Int8Array);
            const result = ggwaveModule.decode(ggwaveInstance, input);

            if (result && result.length > 0) {
                const decoded = new TextDecoder('utf-8').decode(result);
                const message = window.SonicLink.unpackMessage(decoded, settings);

                if (!markPacketSeen(message.signature)) {
                    renderMessage(message, 'incoming');
                    setStatus(`Packet received from ${message.from}`);
                }
            }
        };

        mediaSource.connect(analyser);
        mediaSource.connect(recorder);
        recorder.connect(audioCtx.destination);

        isListening = true;
        rxBtn.textContent = 'Stop Listening';
        receiverHint.textContent = 'Receiver live. Keep the speaker close and the room quiet for cleaner decodes.';
        setStatus('Listening for signal...');
    }

    function stopReceiver(options = {}) {
        if (recorder) {
            recorder.disconnect();
            recorder.onaudioprocess = null;
            recorder = null;
        }

        if (mediaSource) {
            mediaSource.disconnect();
            mediaSource = null;
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach((track) => track.stop());
            mediaStream = null;
        }

        isListening = false;
        rxBtn.textContent = 'Start Listening';
        receiverHint.textContent = 'Keep this page open and the mic permission allowed while listening.';

        if (!options.silent) {
            setStatus('Receiver stopped');
        }
    }

    async function toggleReceiver() {
        rxBtn.disabled = true;

        try {
            if (isListening) {
                stopReceiver();
            } else {
                await startReceiver();
            }
        } catch (error) {
            setStatus(`Receiver error: ${error.message}`);
        } finally {
            rxBtn.disabled = false;
        }
    }

    async function sendMessage() {
        txBtn.disabled = true;

        try {
            applySettings();
            await initEngine();

            const text = composeInput.value.trim();
            if (!text) {
                setStatus('Type a short message first');
                return;
            }

            const packed = window.SonicLink.packMessage(text, settings);
            if (packed.bytes > window.SonicLink.MAX_PACKET_BYTES) {
                setStatus(`Message too large: ${packed.bytes}/${window.SonicLink.MAX_PACKET_BYTES} bytes`);
                updateDraftMeter();
                return;
            }

            const preview = window.SonicLink.unpackMessage(packed.payload, settings);
            renderMessage(preview, 'outgoing');

            if (isListening) {
                restartReceiverAfterSend = true;
                stopReceiver({ silent: true });
            }

            const waveform = ggwaveModule.encode(ggwaveInstance, packed.payload, parseInt(settings.protocol, 10), 10);
            const samples = convertTypedArray(waveform, Float32Array);
            const buffer = audioCtx.createBuffer(1, samples.length, audioCtx.sampleRate);
            buffer.getChannelData(0).set(samples);

            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(audioCtx.destination);
            source.connect(analyser);
            source.start(0);

            composeInput.value = '';
            updateDraftMeter();
            setStatus(`Broadcasting ${packed.bytes} bytes...`);

            source.onended = async () => {
                if (restartReceiverAfterSend) {
                    restartReceiverAfterSend = false;

                    try {
                        await startReceiver();
                        setStatus('Pulse sent. Receiver re-armed.');
                    } catch (error) {
                        setStatus(`Pulse sent, but receiver restart failed: ${error.message}`);
                    }
                } else {
                    setStatus('Pulse sent');
                }
            };
        } catch (error) {
            const shouldRecoverReceiver = restartReceiverAfterSend;
            restartReceiverAfterSend = false;

            if (shouldRecoverReceiver && !isListening) {
                try {
                    await startReceiver();
                    setStatus(`Send failed: ${error.message}. Receiver restored.`);
                } catch (restartError) {
                    setStatus(`Send failed: ${error.message}. Receiver restart failed: ${restartError.message}`);
                }
            } else {
                setStatus(`Send failed: ${error.message}`);
            }
        } finally {
            txBtn.disabled = false;
        }
    }

    function drawSpectrum() {
        const canvas = document.getElementById('visualizer');
        const ctx = canvas.getContext('2d');

        function render() {
            requestAnimationFrame(render);

            if (!analyser) {
                return;
            }

            const width = Math.max(1, Math.floor(canvas.clientWidth));
            const height = Math.max(1, Math.floor(canvas.clientHeight));

            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const barWidth = (canvas.width / bufferLength) * 2.25;
            let x = 0;

            for (let i = 0; i < bufferLength; i += 1) {
                const barHeight = (dataArray[i] / 255) * canvas.height;
                const r = 34;
                const g = i > bufferLength * 0.72 ? 211 : 105 + Math.round(dataArray[i] / 8);
                const b = 238;
                ctx.fillStyle = `rgb(${r}, ${Math.min(255, g)}, ${b})`;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        }

        render();
    }

    composeInput.addEventListener('input', updateDraftMeter);
    composeInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    txBtn.addEventListener('click', sendMessage);
    rxBtn.addEventListener('click', toggleReceiver);
    clearBtn.addEventListener('click', clearTranscript);

    applySettings();
    updateMessageCount();
    updateBandLabel();
    setStatus('Loading modem...');
});
