document.addEventListener('DOMContentLoaded', () => {
    const callsignInput = document.getElementById('callsignInput');
    const protocolSelect = document.getElementById('protocolSelect');
    const secretInput = document.getElementById('secretInput');
    const crypticMode = document.getElementById('crypticMode');
    const setupForm = document.getElementById('setupForm');
    const resetBtn = document.getElementById('resetBtn');
    const setupStatus = document.getElementById('setupStatus');
    const summaryBudget = document.getElementById('summaryBudget');
    const budgetNote = document.getElementById('budgetNote');

    function readForm() {
        return {
            callsign: callsignInput.value,
            protocol: protocolSelect.value,
            cryptic: crypticMode.checked,
            secret: secretInput.value
        };
    }

    function applySettings(settings) {
        callsignInput.value = settings.callsign;
        protocolSelect.value = settings.protocol;
        crypticMode.checked = settings.cryptic;
        secretInput.value = settings.secret;
        renderSummary();
    }

    function renderSummary() {
        const settings = readForm();
        const modeText = settings.cryptic ? 'Cryptic packets leave less room for message text.' : 'Open packets leave the most room for message text.';
        summaryBudget.textContent = `${window.SonicLink.MAX_PACKET_BYTES} byte radio budget`;
        budgetNote.textContent = `The modem can only carry ${window.SonicLink.MAX_PACKET_BYTES} bytes per packet. ${modeText}`;
        setupStatus.textContent = `Current profile: ${settings.callsign || 'Ghost'} • ${window.SonicLink.getProtocolLabel(settings.protocol)} • ${settings.cryptic ? 'Cryptic' : 'Open'} mode`;
    }

    function persist() {
        const saved = window.SonicLink.saveSettings(readForm());
        applySettings(saved);
    }

    applySettings(window.SonicLink.loadSettings());

    [callsignInput, protocolSelect, secretInput, crypticMode].forEach((element) => {
        element.addEventListener('input', persist);
        element.addEventListener('change', persist);
    });

    setupForm.addEventListener('submit', (event) => {
        event.preventDefault();
        persist();
        setupStatus.textContent = 'Setup saved. Opening chat...';
        window.location.href = 'chat.html';
    });

    resetBtn.addEventListener('click', () => {
        applySettings(window.SonicLink.defaultSettings());
        persist();
        setupStatus.textContent = 'Setup reset to defaults.';
    });
});
