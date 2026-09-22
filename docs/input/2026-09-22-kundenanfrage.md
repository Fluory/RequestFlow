# Kundenanfrage (Original, wörtlich)

> Eingang: 2026-09-22 · Absender: fiktiver Kunde (mittelständisches Unternehmen, Anlagen- und Maschinenbau)
> Nur Absätze wiederhergestellt, Wortlaut unverändert. Referenz-/Testprojekt: Die Anfrage ist ein
> Übungsfall ohne realen Absender und darf ins öffentliche Repo (PROJECT-START.md §3).

---

Hallo Florian,

wir sind ein mittelständisches Unternehmen im Bereich Anlagen- und Maschinenbau und möchten einen aktuell größtenteils manuellen Prozess digitalisieren.

Unser Vertrieb erhält täglich etwa 20–50 Angebotsanfragen per E-Mail. Die relevanten Informationen befinden sich entweder direkt im E-Mail-Text oder in Anhängen wie PDFs, Excel-Dateien und Word-Dokumenten. Aktuell müssen unsere Mitarbeiter jede Anfrage öffnen, die Informationen manuell heraussuchen und anschließend in unsere interne Auftragsübersicht übertragen.

Wir würden diesen Prozess gerne mit einer internen Webanwendung und KI-Unterstützung vereinfachen.

## Gewünschter Ablauf

Eine neue Anfrage soll entweder automatisch aus einem Postfach eingelesen oder von einem Mitarbeiter manuell hochgeladen werden können.

Das System soll anschließend möglichst automatisch Informationen wie Unternehmen, Ansprechpartner, Kontaktdaten, angefragte Produkte/Positionen, Mengen, Materialien, Abmessungen, gewünschten Liefertermin und zusätzliche Anforderungen aus den vorhandenen Dokumenten erkennen.

Uns ist dabei wichtig, dass die KI keine Informationen erfindet. Wenn etwas nicht eindeutig erkannt werden kann, soll das entsprechend gekennzeichnet werden.

Ein Mitarbeiter soll die Ergebnisse anschließend in einer übersichtlichen Oberfläche prüfen können. Idealerweise möchten wir neben dem erkannten Wert auch sehen können, aus welchem Dokument bzw. welcher Stelle die Information stammt.

Der Mitarbeiter soll Werte korrigieren und die Anfrage anschließend freigeben oder ablehnen können.

Nach der Freigabe sollen die strukturierten Daten gespeichert und an unser bestehendes ERP-System übertragen werden. Für die erste Version reicht hier eine simulierte REST-Schnittstelle, da wir die echte ERP-Anbindung später gemeinsam umsetzen würden.

## Weitere Anforderungen

Die Anwendung soll von mehreren Mitarbeitern genutzt werden können und benötigt daher einen Login sowie eine einfache Benutzer- und Rechteverwaltung. Anfragen sollten beispielsweise die Status Neu, Verarbeitung, Prüfung, Freigegeben, Fehler und Exportiert besitzen.

Außerdem benötigen wir eine nachvollziehbare Historie darüber, wer welche Daten geändert oder freigegeben hat.

Doppelt eingegangene bzw. hochgeladene Anfragen sollten nach Möglichkeit erkannt werden. Insbesondere darf eine Anfrage nicht versehentlich zweimal an unser ERP übertragen werden.

Falls die KI-Schnittstelle oder ein anderer externer Dienst vorübergehend nicht verfügbar ist, darf die Anfrage nicht verloren gehen. Sie sollte später erneut verarbeitet werden können und der Fehler sollte für den Mitarbeiter sichtbar sein.

Da zukünftig möglicherweise mehrere unserer Gesellschaften das System verwenden sollen, sollte bei der technischen Umsetzung berücksichtigt werden, dass Benutzer ausschließlich die Daten ihres jeweiligen Unternehmens sehen dürfen.

## Qualität der KI

Für uns wäre außerdem wichtig, nachvollziehen zu können, wie zuverlässig die automatische Extraktion funktioniert.

Wir möchten deshalb für die wichtigsten Felder eine kleine Testsammlung aufbauen, mit der beispielsweise nach Änderungen an Prompts oder Modellen überprüft werden kann, ob sich die Extraktionsqualität verschlechtert hat.

## Erste Version

Für den ersten Pilot benötigen wir noch keine perfekte Enterprise-Lösung. Uns ist wichtiger, innerhalb kurzer Zeit eine vollständig nutzbare End-to-End-Version zu erhalten, die wir mit einigen Mitarbeitern testen können.

Der Pilot sollte mindestens folgenden Prozess vollständig abdecken:

Anfrage erhalten/hochladen → Dokumente verarbeiten → Informationen extrahieren → Ergebnisse prüfen und korrigieren → Anfrage freigeben → Daten über Schnittstelle exportieren.

Die konkrete technische Architektur würden wir gerne dir überlassen. Wichtig sind uns eine saubere technische Umsetzung, Erweiterbarkeit und ein nachvollziehbarer Betrieb.

Wenn der Pilot funktioniert, würden wir im nächsten Schritt gerne über die Anbindung unseres tatsächlichen E-Mail-Postfachs und ERP-Systems sowie einen produktiven Rollout sprechen.

Kannst du uns bitte einen Vorschlag schicken, wie du das Projekt technisch und organisatorisch angehen würdest, welche offenen Fragen du vor Projektstart noch hast und welchen Umfang du für einen ersten Pilot empfehlen würdest?
