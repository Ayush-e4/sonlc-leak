document.addEventListener('DOMContentLoaded', () => {
    const callsignInput = document.getElementById('callsignInput');
    const protocolSelect = document.getElementById('protocolSelect');
    const setupForm = document.getElementById('setupForm');
    const resetBtn = document.getElementById('resetBtn');
    const setupStatus = document.getElementById('setupStatus');
    const summaryBudget = document.getElementById('summaryBudget');
    const budgetNote = document.getElementById('budgetNote');

    if (!callsignInput || !protocolSelect || !setupForm || !resetBtn || !setupStatus || !summaryBudget || !budgetNote) {
        return;
    }

    function readForm() {
        return {
            callsign: callsignInput.value,
            protocol: protocolSelect.value
        };
    }

    function applySettings(settings) {
        callsignInput.value = settings.callsign;
        protocolSelect.value = settings.protocol;
        renderSummary();
    }

    function renderSummary() {
        const settings = readForm();
        summaryBudget.textContent = `${window.SonicLink.MAX_PACKET_BYTES}-byte packet limit`;
        budgetNote.textContent = 'Short messages send more reliably.';
        setupStatus.textContent = `Current profile: ${settings.callsign || 'Ghost'} • ${window.SonicLink.getProtocolLabel(settings.protocol)}`;
    }

    function persist() {
        const saved = window.SonicLink.saveSettings(readForm());
        applySettings(saved);
    }

    applySettings(window.SonicLink.loadSettings());

    [callsignInput, protocolSelect].forEach((element) => {
        element.addEventListener('input', persist);
        element.addEventListener('change', persist);
    });

    setupForm.addEventListener('submit', (event) => {
        event.preventDefault();
        persist();
        setupStatus.textContent = 'Opening chat...';
        window.location.href = 'chat.html';
    });

    resetBtn.addEventListener('click', () => {
        applySettings(window.SonicLink.defaultSettings());
        persist();
        setupStatus.textContent = 'Settings reset.';
    });
});
