// ==UserScript==
// @name         Auto-Export ADP vers Compteur
// @namespace    http://tampermonkey.net/
// @version      2.7
// @description  Bascule automatiquement sur Fiche de présence, extrait et ferme ADP UNIQUEMENT en mode auto-sync
// @match        https://mon.adp.com/*
// @match        https://*.adp.com/*
// @include      https://mon.adp.com/*
// @include      https://*.adp.com/*
// @allFrames    true
// @grant        GM_closeTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        window.close
// @run-at       document-body
// ==/UserScript==

(function() {
    'use strict';

    // 1. Détection du mode synchro automatique
    const urlHasAutoSync = window.location.hash.includes('auto-sync') || window.location.search.includes('auto-sync');
    if (urlHasAutoSync) {
        // Mémorise la demande pendant 30 secondes max pour survivre aux redirections SSO
        GM_setValue('adp_sync_requested_time', Date.now());
    }

    const lastSyncTime = GM_getValue('adp_sync_requested_time', 0);
    const isAutoSync = (Date.now() - lastSyncTime) < 30000; // Actif uniquement si déclenché il y a moins de 30s

    // Si on est en accès libre normal, on n'automatise rien
    if (!isAutoSync) {
        console.log('[Compteur ADP v2.7] Accès manuel : automatisation désactivée.');
        // On affiche uniquement le bouton d'export manuel une fois les dates chargées
        surveillerTableau(false);
        return;
    }

    console.log('[Compteur ADP v2.7] Mode synchro automatique actif.');

    // 2. Bascule automatique sur l'onglet "Fiche de présence" (uniquement en auto-sync)
    let clickedOnce = false;
    const tabInterval = setInterval(function() {
        const els = Array.from(document.querySelectorAll('*'));
        const hasDates = els.some(function(e) {
            return e.children.length === 0 && e.innerText && /^\d{2}\/\d{2}$/.test(e.innerText.trim());
        });

        if (hasDates) {
            clearInterval(tabInterval);
            return;
        }

        const tab = document.getElementById('sdf-tab-time-timecard');
        if (tab && !clickedOnce) {
            console.log('[Compteur ADP] Onglet #sdf-tab-time-timecard détecté. Clic...');
            tab.click();
            clickedOnce = true;
            setTimeout(function() { clickedOnce = false; }, 2000);
        }
    }, 400);

    // 3. Surveillance et extraction avec fermeture d'onglet
    surveillerTableau(true, tabInterval);

    function surveillerTableau(shouldClose, navIntervalToClear) {
        let executed = false;
        const checkInterval = setInterval(function() {
            if (executed) return;

            const els = Array.from(document.querySelectorAll('*'));
            const foundDates = [];

            els.forEach(function(e) {
                if (e.children.length === 0 && e.innerText) {
                    const m = e.innerText.trim().match(/^(\d{2}\/\d{2})$/);
                    if (m && !foundDates.includes(m[1])) foundDates.push(m[1]);
                }
            });

            if (foundDates.length > 0) {
                executed = true;
                clearInterval(checkInterval);
                if (navIntervalToClear) clearInterval(navIntervalToClear);

                if (shouldClose) {
                    // Réinitialise le jeton pour ne pas relancer par accident plus tard
                    GM_setValue('adp_sync_requested_time', 0);
                    extraireEtRediriger(true);
                } else {
                    creerBoutonExport();
                }
            }
        }, 500);
    }

    function creerBoutonExport() {
        if (document.getElementById('btn-export-compteur')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-export-compteur';
        btn.innerHTML = '⏱️ Ouvrir dans Compteur';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: '2147483647',
            padding: '10px 16px',
            backgroundColor: '#4f46e5',
            color: '#ffffff',
            border: '2px solid #ffffff',
            borderRadius: '10px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
            fontSize: '13px',
            fontWeight: '700',
            cursor: 'pointer',
            fontFamily: 'sans-serif'
        });

        btn.onclick = async () => {
            btn.innerHTML = '⏳ Extraction...';
            btn.disabled = true;
            await extraireEtRediriger(false);
            btn.innerHTML = '✅ Envoyé';
            setTimeout(() => { btn.innerHTML = '⏱️ Ouvrir dans Compteur'; btn.disabled = false; }, 2000);
        };

        (document.body || document.documentElement).appendChild(btn);
    }

    function fermerOngletActuel() {
        try {
            if (typeof GM_closeTab === 'function') {
                GM_closeTab();
            } else {
                window.close();
            }
        } catch (e) {
            window.close();
        }
    }

    async function extraireEtRediriger(closeAfter) {
        try {
            const d = {
                source: 'adp',
                extractedAt: new Date().toISOString(),
                carrySign: '+',
                carryH: 0,
                carryM: 0,
                days: {
                    Lundi: { times: [], isConge: false, absenceStr: '' },
                    Mardi: { times: [], isConge: false, absenceStr: '' },
                    Mercredi: { times: [], isConge: false, absenceStr: '' },
                    Jeudi: { times: [], isConge: false, absenceStr: '' },
                    Vendredi: { times: [], isConge: false, absenceStr: '' }
                }
            };

            const daysKeys = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
            const els = Array.from(document.querySelectorAll('*'));
            const foundDates = [];

            els.forEach(function(e) {
                if (e.children.length === 0 && e.innerText) {
                    const m = e.innerText.trim().match(/^(\d{2}\/\d{2})$/);
                    if (m && !foundDates.includes(m[1])) foundDates.push(m[1]);
                }
            });

            const map = [];
            for (let i = 0; i < Math.min(5, foundDates.length); i++) {
                map.push({ n: daysKeys[i], d: foundDates[i] });
            }

            const dt = new Date();
            const todayStr = String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
            d.isCurrentWeek = map.some(function(m) { return m.d === todayStr; });

            map.forEach(function(m) {
                const el = els.find(function(e) { return e.children.length === 0 && e.innerText && e.innerText.trim() === m.d; });
                if (!el) return;
                let c = el;
                while (c.parentElement && c.parentElement !== document.body) {
                    const p = c.parentElement;
                    if (map.some(function(o) { return o.d !== m.d && (p.innerText || '').includes(o.d); })) break;
                    c = p;
                }
                const t = c.innerText || '';
                if (/Congé|RTT|Chômé|Férié|Activité\s+partielle/i.test(t)) d.days[m.n].isConge = true;

                let absIntervals = [];
                const lines = t.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
                for (let i = 0; i < lines.length; i++) {
                    if (/Débit|Crédit/i.test(lines[i])) {
                        let timeStr = "";
                        if (/\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/.test(lines[i])) timeStr = lines[i];
                        else if (i + 1 < lines.length && /\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/.test(lines[i + 1])) timeStr = lines[i + 1];
                        let match = timeStr.match(/([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)/);
                        if (match) absIntervals.push(match[1].padStart(2, '0') + ':' + match[2] + ' - ' + match[3].padStart(2, '0') + ':' + match[4]);
                    }
                }

                if (absIntervals.length > 0) d.days[m.n].absenceStr = absIntervals.join(', ');
                else if (/Débit|Crédit/i.test(t)) d.days[m.n].absenceStr = 'Oui';

                let pts = [];
                for (let i = 0; i < lines.length; i++) {
                    if (/Pointage/i.test(lines[i])) {
                        let timeStr = "";
                        if (/\d{2}:\d{2}/.test(lines[i])) timeStr = lines[i];
                        else if (i + 1 < lines.length && /\d{2}:\d{2}/.test(lines[i + 1])) timeStr = lines[i + 1];
                        let match = timeStr.match(/([01]?\d|2[0-3]):([0-5]\d)/);
                        if (match) pts.push(match[1].padStart(2, '0') + ':' + match[2]);
                    }
                }

                if (pts.length > 0) {
                    d.days[m.n].times = Array.from(new Set(pts));
                } else {
                    const rawTimes = Array.from(t.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)).map(function(x) { return x[1].padStart(2, '0') + ':' + x[2]; }).filter(function(h) { return !['09:00', '12:00', '13:00', '17:00', '17:24', '00:00', '03:00'].includes(h); });
                    let absToRemove = [];
                    absIntervals.forEach(function(interval) {
                        const parts = interval.split(' - ');
                        absToRemove.push(parts[0], parts[1]);
                    });
                    d.days[m.n].times = Array.from(new Set(rawTimes)).filter(function(h) { return !absToRemove.includes(h); });
                }
            });

            try {
                const entries = performance.getEntriesByType('resource').map(function(r) { return r.name; });
                const m = entries.find(function(u) { return u.includes('/workers/') || u.includes('/associates/'); });
                let workerId = '';
                if (m) {
                    const match = m.match(/(?:workers|associates)\/([a-zA-Z0-9\-_]+)/);
                    if (match) workerId = match[1];
                }
                if (workerId) {
                    const targetUrl = 'https://mon.adp.com/time/v3/workers/' + workerId + '/time-off-balances';
                    const res = await fetch(targetUrl, { credentials: 'same-origin' });
                    const str = await res.text();
                    const rm = str.match(/MOBHV2[\s\S]*?"timeValue"\s*:\s*"([+-]?)(\d{1,2}):(\d{2})"/i) || str.match(/Débit\/Crédit[\s\S]*?"timeValue"\s*:\s*"([+-]?)(\d{1,2}):(\d{2})"/i);
                    if (rm) {
                        d.carrySign = rm[1] === '-' ? '-' : '+';
                        d.carryH = parseInt(rm[2], 10);
                        d.carryM = parseInt(rm[3], 10);
                    }
                }
            } catch (e) {
                console.warn(e);
            }

            const out = JSON.stringify(d);
            const targetUrl = "https://railounet.github.io/compteur-heures/?data=" + encodeURIComponent(out);

            if (closeAfter) {
                window.open(targetUrl, 'compteur_main_window');
                setTimeout(function() {
                    fermerOngletActuel();
                }, 300);
            } else {
                window.open(targetUrl, '_blank');
            }

        } catch (err) {
            console.error('[Compteur ADP] Erreur d\'extraction :', err);
        }
    }
})();
