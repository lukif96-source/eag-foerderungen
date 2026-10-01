// Tests für js/oemag.js – an echten OeMAG-Mails (Wortlaut original, Zählpunkte/Nummern verändert)
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../js/oemag.js');

const TICKET = {
  betreff: 'Ticketziehung', datum: '2026-06-16T15:04:40Z',
  text: `Sehr geehrte(r) Förderwerberin/Förderwerber!
Ihr Ticket mit der Nummer 4b7e21 zum Einspeisezählpunkt AT0030000000000000000000030999111 wurde am 16.06.2026 um 17:04:35 Uhr von Ihnen gezogen.
Mit Ihrem Ticket haben Sie den ersten Schritt für einen Antrag auf Investitionszuschuss nach dem Erneuerbaren-Ausbau-Gesetz (EAG) gesetzt.
Im [EAG Portal](https://einreichen.eag-abwicklungsstelle.at/eag/) haben Sie ab morgen die Möglichkeit, einen Antrag für Ihr Projekt einzureichen. Die Einreichung Ihres Förderantrages ist bis zum Ende des Fördercalls am 30.06.2026 um 23:59 Uhr möglich. Danach verfällt das Ticket und kann nicht mehr verwendet werden.
Weitere Schritte:

1. [Registrierung im EAG Portal](https://einreichen.eag-abwicklungsstelle.at/eag/register)
2. [Einloggen](https://einreichen.eag-abwicklungsstelle.at/eag/login)
3. Projekterfassung
4. Antragseinreichung

Die Schritte 1-3 können bereits vor einem geöffneten Fördercall erfolgen. Mit der Antragseinreichung erhält Ihr Förderantrag den Ticketziehungszeitpunkt.
Zu jedem Einspeisezählpunkt kann nur ein Antrag eingebracht werden.`
};
const NACHFORDERUNG = {
  betreff: 'Nachforderung von Unterlagen', datum: '2026-08-03T08:12:00Z',
  text: `DIESES SCHREIBEN WURDE AUTOMATISCH VERSANDT - BITTE ANTWORTEN SIE NICHT AUF DIESE E-MAIL!
Sehr geehrte(r) Förderwerberin/Förderwerber!
Zu Ihrer Endabrechnung zu EAG00051111 mit der Zählpunktbezeichnung AT0030000000000000000000030999222 benötigen wir noch weitere Unterlagen/Informationen innerhalb der 4-Wochenfrist bis spätestens 31.08.2026

* Leasingvertrag
* Nachweis der Nettokapazität Stromspeicher

Der Rechnungsadressat stimmt nicht mit dem Förderwerber überein. Wir bitten um Klarstellung bzw. Übermittlung eines Vertrages (zb Leasingvertrag). Bitte laden Sie eine Bestätigung zur NETTO-Kapazität des Stromspeichers hoch (zb ein Datenblatt).
Hierzu loggen Sie sich bitte im [EAG Portal](https://einreichen.eag-abwicklungsstelle.at/eag/login) ein! Nachreichungen per Mail oder Post können nicht berücksichtigt werden.
Für Rückfragen stehen wir Ihnen gerne zur Verfügung.`
};
const ABLEHNUNG = {
  betreff: 'Ihre Projekteinreichung', datum: '2026-07-08T09:30:00Z',
  text: `DIESES SCHREIBEN WURDE AUTOMATISCH VERSANDT - BITTE ANTWORTEN SIE NICHT AUF DIESE E-MAIL!
Sehr geehrte(r) Förderwerberin/Förderwerber!
Ihre Projekteinreichung Nr. EAG00093333 zur Anlage mit Zählpunktbezeichnung AT003000 00000 00000 00000 00309 99333 wurde geprüft, aus folgendem Grund kann diese leider nicht berücksichtigt werden:
Keine ausreichenden Fördermittel vorhanden: Gemäß § 55 EAG Abs 5 gilt Ihr Antrag somit als zurückgezogen. Informationen zu weiteren Fördermöglichkeiten finden Sie unter [www.eag-abwicklungsstelle.at](https://www.eag-abwicklungsstelle.at).
Für Rückfragen stehen wir Ihnen gerne zur Verfügung.`
};
const liste = () => [
  { id: 't', kunde: 'Ticket Toni', zaehlpunkt: '0030000000000000000000030999111', foerdercall: '2026-06-16', eag_nr: '', ticket: '', fpj: 'FPJ00111111', schritte: { projekt: '✓' }, offene_punkte: '', info: '' },
  { id: 'n', kunde: 'Nachreich Nora', zaehlpunkt: 'AT0030000000000000000000030999222', foerdercall: '2026-04-23', eag_nr: '', ticket: 'aa11bb', fpj: '',
    schritte: { projekt: '✓', ticket: '✓', eingereicht: '✓', vertrag_erhalten: '2026-05-10', vertrag_versendet: '✓', inbetriebnahme: '2026-07-01', rechnung: '✓', zahlung: '✓', abgeschlossen: '2026-07-20' }, offene_punkte: 'Rechnung prüfen', info: '' },
  { id: 'a', kunde: 'Abgelehnt Alois', zaehlpunkt: 'AT 0030000000000000000000030999333', foerdercall: '2026-06-16', eag_nr: 'EAG00093333', ticket: 'cc22dd', fpj: '',
    schritte: { projekt: '✓', ticket: '2026-06-16', eingereicht: '2026-06-18' }, offene_punkte: '', info: '' },
  { id: 'x', kunde: 'Papierkorb', zaehlpunkt: 'AT0030000000000000000000030999111', geloescht_am: '2026-01-01', schritte: {} }
];

test('Ticket-Mail: Nummer, Zählpunkt, Tag und Uhrzeit – automatisch', () => {
  const e = O.lesen(TICKET);
  assert.equal(e.art, 'ticket');
  assert.equal(e.sicher, true);
  assert.equal(e.ticket, '4b7e21');
  assert.equal(e.zaehlpunkt, 'AT0030000000000000000000030999111');
  assert.equal(e.datum, '2026-06-16');
  assert.equal(e.uhrzeit, '17:04:35');
  assert.equal(e.eagNr, null);
  assert.deepEqual(e.unterlagen, []);                 // die Portal-Schritte sind keine Unterlagen
  const r = O.verarbeiten(TICKET, liste());
  assert.equal(r.foerderung.id, 't');                  // Zählpunkt ohne AT gespeichert, Papierkorb ignoriert
  assert.equal(r.zuordnung, 'zaehlpunkt');
  assert.equal(r.status, 'angewendet');
  assert.equal(r.automatisch.ticket, '4b7e21');
  assert.equal(r.automatisch.schritte.ticket, '2026-06-16');
  assert.equal(r.automatisch.schritte.ticket_uhrzeit, '17:04:35');
  assert.equal(r.automatisch.schritte.projekt, undefined);   // nur der Unterschied …
  assert.deepEqual(O.anwenden(liste()[0], r.automatisch).schritte, { projekt: '✓', ticket: '2026-06-16', ticket_uhrzeit: '17:04:35' });   // … zusammengeführt
});

test('Nachforderung zur Endabrechnung: EAG-Nr., Frist aus der Mail, Unterlagen als offene Punkte', () => {
  const e = O.lesen(NACHFORDERUNG);
  assert.equal(e.art, 'nachforderung_abrechnung');
  assert.equal(e.sicher, true);
  assert.equal(e.eagNr, 'EAG00051111');
  assert.equal(e.fristBis, '2026-08-31');
  assert.deepEqual(e.unterlagen, ['Leasingvertrag', 'Nachweis der Nettokapazität Stromspeicher']);
  const r = O.verarbeiten(NACHFORDERUNG, liste());
  assert.equal(r.foerderung.id, 'n');
  assert.equal(r.automatisch.eag_nr, 'EAG00051111');
  assert.equal(r.automatisch.schritte.nachforderung_abrechnung, '2026-08-03');   // 31.08. − 4 Wochen
  const p = O.anwenden(liste()[1], r.automatisch);
  assert.equal(p.offene_punkte, 'Rechnung prüfen · Nachreichen bis 31.08.2026: Leasingvertrag; Nachweis der Nettokapazität Stromspeicher');
  assert.equal(O.anwenden(Object.assign({}, liste()[1], p), r.automatisch).offene_punkte, undefined);   // nicht doppelt anhängen
  // Mit den Regeln aus ablauf.js ergibt das genau die Frist aus der Mail
  const A = require('../js/ablauf.js');
  const f = Object.assign({}, liste()[1], p);
  assert.equal(A.fristen(f, '2026-08-10')[0].datum, '2026-08-31');
  assert.equal(A.aufgabe(f).key, 'nachgereicht_abrechnung');
});

test('Ablehnung: Zählpunkt mit Leerzeichen, Grund in der Info, über die EAG-Nr. zugeordnet', () => {
  const e = O.lesen(ABLEHNUNG);
  assert.equal(e.art, 'abgelehnt');
  assert.equal(e.sicher, true);
  assert.equal(e.zaehlpunkt, 'AT0030000000000000000000030999333');
  assert.equal(e.eagNr, 'EAG00093333');
  assert.equal(e.grund, 'Keine ausreichenden Fördermittel vorhanden');
  const r = O.verarbeiten(ABLEHNUNG, liste());
  assert.equal(r.foerderung.id, 'a');
  assert.equal(r.zuordnung, 'eag_nr');
  assert.equal(r.automatisch.schritte.abgelehnt, '2026-07-08');
  assert.equal(O.anwenden(liste()[2], r.automatisch).info, 'OeMAG: Keine ausreichenden Fördermittel vorhanden');
  assert.equal(r.automatisch.eag_nr, undefined);       // war schon eingetragen
});

test('Zweimal dieselbe Mail: beim zweiten Mal nichts mehr zu tun', () => {
  const l = liste();
  const r1 = O.verarbeiten(TICKET, l);
  Object.assign(l[0], O.anwenden(l[0], r1.automatisch));
  const r2 = O.verarbeiten(TICKET, l);
  assert.equal(r2.status, 'erledigt');
  assert.deepEqual(r2.automatisch, {});
});

test('Nie überschreiben: anderes Datum schon eingetragen → Hinweis statt Änderung', () => {
  const l = liste();
  l[2].schritte.abgelehnt = '2026-07-01';
  const r = O.verarbeiten(ABLEHNUNG, l);
  assert.equal(r.automatisch.schritte, undefined);
  assert.equal(r.status, 'vorschlag');                                   // bleibt zur Prüfung stehen
  assert.ok(r.notizen.some(n => /Abgelehnt.*in der App 01\.07\.2026, laut Mail 08\.07\.2026/.test(n)), r.notizen.join(' | '));
});

test('Ohne Treffer oder mehrdeutig: offen im Posteingang, nichts geändert', () => {
  const fremd = O.verarbeiten(Object.assign({}, TICKET, { text: TICKET.text.replace('30999111', '30999999') }), liste());
  assert.equal(fremd.status, 'offen');
  assert.equal(fremd.foerderung, null);
  const doppelt = liste().concat([{ id: 'd', kunde: 'Doppel', zaehlpunkt: 'AT0030000000000000000000030999111', schritte: {} }]);
  const r = O.verarbeiten(TICKET, doppelt);
  assert.equal(r.zuordnung, 'mehrdeutig');
  assert.deepEqual(r.kandidaten.sort(), ['d', 't']);
});

test('Noch nicht geprüfte Mail-Art (Fördervertrag): nur Vorschlag, Kennungen trotzdem sofort', () => {
  const vertrag = { betreff: 'Fördervertrag', datum: '2026-07-20T10:00:00Z',
    text: 'Ihr Fördervertrag zu EAG00051111 mit der Zählpunktbezeichnung AT0030000000000000000000030999222 steht im Portal bereit.' };
  const l = liste(); l[1].schritte = { projekt: '✓', ticket: '✓', eingereicht: '✓' };
  const r = O.verarbeiten(vertrag, l);
  assert.equal(r.erkannt.art, 'vertrag_erhalten');
  assert.equal(r.erkannt.sicher, false);
  assert.equal(r.status, 'vorschlag');
  assert.equal(r.automatisch.eag_nr, 'EAG00051111');
  assert.equal(r.vorschlag.schritte.vertrag_erhalten, '2026-07-20');
});

test('HTML-Mails werden zu Text, Aufzählungen bleiben erkennbar', () => {
  const html = '<p>Zu Ihrer Endabrechnung zu EAG00051111 benötigen wir noch weitere Unterlagen bis spätestens 31.08.2026</p><ul><li>Leasingvertrag</li><li>Datenblatt</li></ul>';
  const e = O.lesen({ html, datum: '2026-08-03' });
  assert.equal(e.art, 'nachforderung_abrechnung');
  assert.deepEqual(e.unterlagen, ['Leasingvertrag', 'Datenblatt']);
});

test('Übernehmen nach fremder Änderung: nichts geht verloren', () => {
  const l = liste();
  const r = O.verarbeiten(NACHFORDERUNG, l);
  // inzwischen trägt jemand anderer die Auszahlung ein und ändert die offenen Punkte
  const jetzt = Object.assign({}, l[1], { offene_punkte: 'Rechnung prüfen · Kunde angerufen', schritte: Object.assign({}, l[1].schritte, { ausgezahlt: '2026-08-05' }) });
  const p = O.anwenden(jetzt, r.automatisch);
  assert.equal(p.schritte.ausgezahlt, '2026-08-05');
  assert.equal(p.schritte.nachforderung_abrechnung, '2026-08-03');
  assert.ok(p.offene_punkte.startsWith('Rechnung prüfen · Kunde angerufen · Nachreichen'));
});

test('Widerspruch Ticketnummer: nicht überschreiben, aber zur Prüfung vorlegen', () => {
  const l = liste(); l[0].ticket = 'a91f3c';
  const r = O.verarbeiten(TICKET, l);
  assert.equal(r.automatisch.ticket, undefined);
  assert.equal(r.status, 'vorschlag');
  assert.ok(r.notizen[0].startsWith('⚠ Ticketnummer: in der App a91f3c, laut Mail 4b7e21'));
});

test('Weitergeleitet (Outlook, deutsch): Datum der Originalmail, Inhalt wird erkannt', () => {
  const wg = { betreff: 'WG: Nachforderung von Unterlagen', datum: '2026-08-20T09:00:00Z',
    text: `________________________________
Von: EAG Abwicklungsstelle <noreply@oemag.at>
Gesendet: Montag, 3. August 2026 08:12
An: oemag@solpro.at
Betreff: Nachforderung von Unterlagen

` + NACHFORDERUNG.text.replace('bis spätestens 31.08.2026', '') };     // diesmal ohne Frist im Text
  const e = O.lesen(wg);
  assert.equal(e.art, 'nachforderung_abrechnung');
  assert.equal(e.datum, '2026-08-03');                     // nicht der Weiterleitungstag 20.08.
  const r = O.verarbeiten(wg, liste());
  assert.equal(r.automatisch.schritte.nachforderung_abrechnung, '2026-08-03');
});

test('Datum der Originalmail: verschiedene Kopfzeilen', () => {
  assert.equal(O.originalDatum('Sent: Monday, August 3, 2026 8:12 AM'), '2026-08-03');
  assert.equal(O.originalDatum('Datum: 03.08.2026 08:12'), '2026-08-03');
  assert.equal(O.originalDatum('> Gesendet: Mittwoch, 16. Juni 2026 17:05'), '2026-06-16');
  assert.equal(O.originalDatum('Gesendet: Montag, 2. März 2026 09:00'), '2026-03-02');
  assert.equal(O.originalDatum('Kein Kopf hier'), null);
});

test('Weitergeleitete Ticket-Mail: Ticketdatum aus dem Text bleibt maßgeblich', () => {
  const wg = { betreff: 'WG: Ticketziehung', datum: '2026-06-17T08:00:00Z', text: 'Von: noreply@oemag.at\nGesendet: Dienstag, 16. Juni 2026 17:05\n\n' + TICKET.text };
  const e = O.lesen(wg);
  assert.equal(e.datum, '2026-06-16');
  assert.equal(e.uhrzeit, '17:04:35');
});

test('Zählpunkt mit geschützten Leerzeichen (aus HTML/Outlook) wird erkannt', () => {
  const e = O.lesen({ betreff: 'Ticket', text: 'Zählpunkt AT003000 00000 00000 00000 00309 99333' });
  assert.equal(e.zaehlpunkt, 'AT0030000000000000000000030999333');
});
