// ==UserScript==
// @name         Auto-Export ADP vers Compteur
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Synchro automatique via le bouton du compteur, passif en manuel, avec coupe-circuit distant
// @match        https://mon.adp.com/*
// @match        https://static.mon.adp.com/*
// @match        https://*.adp.com/*
// @match        https://raikounet.github.io/compteur-heures/*
// @match        https://railounet.github.io/compteur-heures/*
// @match        *://*/*compteur-heures*
// @connect      raw.githubusercontent.com
// @allFrames    true
// @grant        GM_closeTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-body
// ==/UserScript==

(function() {
    'use strict';

    const GITHUB_REPO_URL = 'https://raw.githubusercontent.com/Raikounet/compteur-heures/main/status.json?t=' + Date.now();

    // 1. Coupe-circuit distant (kill switch)
    function verifierStatutDistant(callback) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            callback(true);
            return;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: GITHUB_REPO_URL,
            timeout: 2500,
            onload: function(response) {
                try {
                    const conf = JSON.parse(response.responseText);
                    callback(conf.active !== false);
                } catch (e) {
                    callback(true); // Actif par défaut si parse impossible
                }
            },
            ontimeout: function() { callback(true); },
            onerror: function() { callback(true); }
        });
    }

    verifierStatutDistant(function(estActif) {
        if (!estActif) {
            console.warn('[Compteur ADP v3.2] Script désactivé à distance via status.json.');
            return;
        }
        demarrerApplication();
    });

    function demarrerApplication() {
        const isSiteCompteur = window.location.href.includes('compteur-heures');

        // =========================================================================
        // A. SITE COMPTEUR D'HEURES
        // =========================================================================
        if (isSiteCompteur) {
            console.log('[Compteur ADP v3.2] Connecté au site du Compteur.');

            document.addEventListener('click', function(e) {
                const btn = e.target && e.target.closest('.btn-sync');
                if (btn) {
                    console.log('[Compteur ADP] Clic synchro détecté. Signal armé (30s).');
                    GM_setValue('SYNC_ADP_TIMESTAMP', Date.now());
                }
            });

            function appliquerDonnees(raw) {
                if (!raw) return;
                try {
                    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (typeof unsafeWindow.importDirectData === 'function') {
                        unsafeWindow.importDirectData(data);
                    } else {
                        window.postMessage({ type: 'ADP_DIRECT_IMPORT', data: data }, '*');
                    }
                    console.log('[Compteur ADP] Données appliquées au tableau de bord.');
                } catch (err) {
                    console.error('[Compteur ADP] Erreur traitement données :', err);
                }
            }

            GM_addValueChangeListener('ADP_DATA_PAYLOAD', function(name, oldVal, newVal) {
                if (newVal) {
                    GM_setValue('ADP_DATA_PAYLOAD', null);
                    appliquerDonnees(newVal);
                }
            });

            return;
        }

        // =========================================================================
        // B. PORTAIL ADP (mon.adp.com)
        // =========================================================================
        const syncTime = GM_getValue('SYNC_ADP_TIMESTAMP', 0);
        const isAutoSync = (Date.now() - syncTime) < 30000;

        if (!isAutoSync) {
            console.log('[Compteur ADP v3.2] Navigation manuelle. Automatisme désactivé, aucun onglet ne sera fermé.');
            surveillerTableau(false);
            return;
        }

        console.log('[Compteur ADP v3.2] Mode auto-sync validé.');
        GM_setValue('SYNC_ADP_TIMESTAMP', 0);

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
                tab.click();
                clickedOnce = true;
                setTimeout(function() { clickedOnce = false; }, 2000);
            }
        }, 400);

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
                        extraireEtEnvoyer(true);
                    } else {
                        creerBoutonManuel();
                    }
                }
            }, 500);
        }

        function creerBoutonManuel() {
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

            btn.onclick = async function() {
                btn.innerHTML = '⏳ Extraction...';
                btn.disabled = true;
                await extraireEtEnvoyer(false);
                btn.innerHTML = '✅ Envoyé';
                setTimeout(function() { btn.innerHTML = '⏱️ Ouvrir dans Compteur'; btn.disabled = false; }, 2000);
            };

            (document.body || document.documentElement).appendChild(btn);
        }

        async function extraireEtEnvoyer(fermerApres = true) {
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
                        if (map.some(o => o.d !== m.d && (p.innerText || '').includes(o.d))) break;
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
                    const m = entries.find(u => u.includes('/workers/') || u.includes('/associates/'));
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
                    console.warn('[Compteur ADP] Solde non récupéré :', e);
                }

                GM_setValue('ADP_DATA_PAYLOAD', JSON.stringify(d));

                if (fermerApres) {
                    setTimeout(function() {
                        try {
                            if (typeof GM_closeTab === 'function') GM_closeTab();
                            else window.close();
                        } catch (e) {
                            window.close();
                        }
                    }, 300);
                }

            } catch (err) {
                console.error('[Compteur ADP] Erreur d\'extraction :', err);
            }
        }
    }
})();
