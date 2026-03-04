# Design Document - Ottimizzazioni Struttura Torneo (Approccio A)
**Data:** 2026-03-04  
**Stato:** Approvato  
**Scope:** regole di qualificazione finali, wildcard, vincoli bracket, calendario condiviso M/F su campo unico.

---

## 1. Obiettivo

Rendere il modello torneo coerente con il flusso operativo reale:
- finali target diverse per genere (`M=8`, `F=4`);
- wildcard realmente usate per completare i posti;
- bracket con vincoli sportivi al primo turno;
- modifica manuale libera con warning;
- pianificazione sempre condivisa Maschile/Femminile su un unico campo.

L'obiettivo è migliorare correttezza sportiva e usabilità senza refactor invasivo del dominio.

---

## 2. Decisioni Confermate

1. **Finali per genere**
- Maschile: target standard 8.
- Femminile: target fisso 4.

2. **Qualificate dirette**
- Passano sempre le prime 2 di ogni girone.

3. **Wildcard**
- Escluse le dirette, si crea classifica comparata per genere.
- Passano tante wildcard quante ne servono per completare il target.
- Ordinamento wildcard: punti totali + ordine spareggi torneo senza scontro diretto.

4. **Gironi di dimensione diversa**
- Classifica comparata basata su punti totali (non media punti).

5. **Overflow qualificazione diretta**
- Maschile: se `2 x numero_gironi > 8`, switch automatico target da 8 a 16 con avviso.
- Femminile: nessuno switch, configurazione/generazione bloccata se dirette > 4.

6. **Formato bracket**
- Maschile 8: Quarti -> Semifinali -> Finale + 3° posto.
- Maschile 16: Ottavi -> Quarti -> Semifinali -> Finale + 3° posto.
- Femminile 4: Semifinali -> Finale + 3° posto.

7. **Vincoli al primo turno (auto-generazione)**
- pairing preferenziale 1ª vs 2ª;
- no scontri tra squadre dello stesso girone;
- wildcard in coda al seeding.

8. **Modifica manuale bracket**
- Libertà completa su incroci e orari.
- Warning di coerenza vincoli, ma nessun blocco.

9. **Precondizione generazione finali**
- Finali generabili solo a gironi chiusi per quel genere.

10. **Scheduling condiviso M/F**
- Configurazione giorni/slot unica condivisa.
- Campo unico: nessuna sovrapposizione M/F nello stesso orario.

11. **Priorità soft**
- Priorità più alta: finali nei giorni finali.
- Preferenze squadra dopo.
- Ravvicinatezza stessa squadra sacrificabile quando necessario.

---

## 3. Architettura Funzionale Target

### 3.1 Qualificazione

Nuovo flusso unico per `generate bracket`:
1. validazione chiusura gironi;
2. calcolo target per genere;
3. estrazione qualificate dirette (top 2 per girone);
4. calcolo classifica wildcard su non qualificate;
5. composizione qualificate finali nel numero target.

### 3.2 Seeding e accoppiamenti primo turno

1. ranking comparato di prime, seconde e wildcard;
2. costruzione accoppiamenti rispettando:
- 1 vs 2 come criterio prioritario;
- esclusione stesso girone al primo turno;
- wildcard collocate in coda;
3. fallback deterministico con warning se i vincoli non sono tutti soddisfacibili.

### 3.3 Manual override

Dopo auto-generazione:
- si possono modificare pairing e orari senza vincoli hard;
- il sistema calcola un report warning (vincoli violati) da mostrare in UI;
- salvataggio sempre consentito.

### 3.4 Calendario condiviso

Setup unico per giorni/slot a livello "coppia M/F".
Il solver lavora sempre in modalità congiunta sui due tornei della coppia, imponendo vincolo hard di non sovrapposizione.

---

## 4. Contratti Applicativi

### 4.1 Backend services (nuovi)

- `qualification_service.py`
  - `compute_target_size(gender, groups_count, direct_count)`
  - `validate_groups_closed(matches)`
  - `build_wildcard_table(teams, standings, tiebreakers_without_h2h)`
  - `select_finalists(...)`

- `seeding_service.py`
  - `rank_group_winners(...)`
  - `rank_group_runners_up(...)`
  - `rank_wildcards(...)`

- `bracket_rules_service.py`
  - `build_first_round_pairings(...)`
  - `detect_pairing_warnings(...)`

### 4.2 Router bracket

`POST /api/tournaments/{tid}/bracket/{gender}` esteso per restituire:
- `target_size` (4/8/16),
- `warnings`,
- dettagli su dirette/wildcard.

Errori guidati:
- gironi non chiusi;
- target femminile non rispettabile;
- insufficienti qualificate per completamento target.

### 4.3 Router schedule/setup

Allineamento a calendario condiviso:
- semplificazione flusso setup per evitare configurazioni divergenti M/F;
- scheduling con companion id automatico lato client (non opzionale in modalità coppia).

---

## 5. UI/UX Target

### 5.1 TournamentSetup
- esplicitare target finali:
  - Maschile: `8` con auto-switch `16` se overflow dirette;
  - Femminile: `4` fisso con blocco.
- un solo set giorni/slot condiviso per coppia M/F.

### 5.2 Bracket
- pannello riepilogo:
  - dirette,
  - wildcard selezionate,
  - target attivo.
- warning non bloccanti in modalità manuale.

### 5.3 Schedule
- rimuovere la scelta "pianifica insieme a..." quando coppia presente;
- comportamento default: solver sempre congiunto su M/F.

---

## 6. Test Strategy

1. **Qualificazione**
- dirette top-2 per girone.
- wildcard completamento target.
- classifica wildcard senza scontro diretto.
- punti totali con gironi asimmetrici.

2. **Target dinamico**
- M: switch 8->16 quando dirette > 8.
- F: blocco se dirette > 4.

3. **Bracket**
- rispetto vincoli primo turno in auto-generazione.
- presenza finale 3° posto in tutti i formati.
- blocco su gironi non chiusi.

4. **Manual override**
- update pairing/orario consentito anche con violazioni.
- warning corretti.

5. **Scheduler condiviso**
- assenza sovrapposizioni M/F.
- generazione congiunta sempre attiva in modalità coppia.

---

## 7. Trade-off e Rischi

1. Mantenere punti totali tra gironi asimmetrici può favorire gironi più numerosi. Decisione consapevole dell'organizzatore.
2. Libertà manuale completa può produrre bracket sportivamente incoerenti; mitigazione tramite warning evidenti.
3. Introduzione regole in router/service richiede test robusti per evitare regressioni su tournament legacy.

---

## 8. Criteri di Accettazione

1. Conclusi i gironi, il sistema genera finali coerenti con target genere.
2. Wildcard sono effettivamente selezionate e tracciabili.
3. Maschile auto-switcha a 16 in overflow dirette; femminile blocca.
4. Primo turno auto-generato evita stesso girone e privilegia 1ª vs 2ª.
5. Manual editing bracket è sempre possibile e segnala violazioni.
6. Pianificazione M/F è condivisa e senza sovrapposizioni orarie.
