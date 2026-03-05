# Manuale Utente Web Application

## Torneo Calcetto Saponato

Versione documento: 1.0  
Ultimo aggiornamento: 2026-03-04

---

## Indice

1. [Introduzione](#1-introduzione)
2. [Requisiti](#2-requisiti)
3. [Accesso allapplicazione](#3-accesso-allapplicazione)
4. [Panoramica dellinterfaccia](#4-panoramica-dellinterfaccia)
5. [Guida completa alle funzionalita](#5-guida-completa-alle-funzionalita)
6. [Suggerimenti e buone pratiche](#6-suggerimenti-e-buone-pratiche)
7. [Problemi comuni e soluzioni](#7-problemi-comuni-e-soluzioni)
8. [Appendice screenshot consigliati](#8-appendice-screenshot-consigliati)

---

> Nota importante
>
> Nel repository non sono presenti screenshot reali gia pronti.
> Questo manuale include i riferimenti immagine consigliati, in modo che tu possa inserire facilmente gli screenshot nella cartella `docs/images/manuale/` mantenendo i nomi file indicati.

---

## 1. Introduzione

### 1.1 Cos e questa web app

Questa applicazione serve per gestire un torneo completo di calcetto saponato su campo singolo.

La piattaforma copre tutto il flusso operativo:

- configurazione torneo
- inserimento squadre
- generazione gironi
- pianificazione calendario
- inserimento risultati
- classifiche e marcatori
- generazione bracket finali
- export CSV/PDF

### 1.2 Scopo dellapplicazione

Lobiettivo e permettere allorganizzazione di gestire tornei maschili e femminili con unuso pratico e veloce, riducendo errori manuali e tempi di coordinamento.

### 1.3 Cosa puo fare lutente

Con questa app un utente organizzatore puo:

- creare una coppia tornei M/F condividendo giorni e slot
- gestire regole sportive (punti, spareggi, avanzamento)
- registrare preferenze e indisponibilita delle squadre
- generare automaticamente gironi e partite
- costruire un calendario con solver automatico
- correggere manualmente incroci e orari quando serve
- gestire risultati, falli e marcatori in tempo reale
- preparare bracket finali automatici, parziali o manuali
- esportare dati pronti per stampa, archivio o comunicazione

---

## 2. Requisiti

### 2.1 Browser supportati

Sono consigliati browser moderni aggiornati:

- Google Chrome (ultima versione)
- Microsoft Edge (ultima versione)
- Mozilla Firefox (ultima versione)
- Safari (ultima versione)

### 2.2 Requisiti pratici di utilizzo

- connessione alla rete locale o al PC dove gira il servizio
- JavaScript abilitato nel browser
- risoluzione consigliata desktop almeno 1366x768
- su mobile e presente una navigazione ridotta in basso

### 2.3 Avvio dellapp

Per uso operativo su Windows puoi usare:

- `AVVIA.bat` per avviare frontend e backend
- `CHIUDI.bat` per arrestare i servizi

In alternativa tecnica:

- frontend su `http://localhost:3000` (Docker) oppure `http://localhost:5173` (locale)
- backend API su `http://localhost:8000`

---

## 3. Accesso allapplicazione

### 3.1 Apertura applicazione

1. Avvia i servizi con `AVVIA.bat`.
2. Apri il browser.
3. Vai allURL mostrato dalla procedura di avvio.

### 3.2 Login

Al momento non e previsto login utente.

Laccesso e diretto allinterfaccia operativa.

### 3.3 Primo controllo rapido

Al primo accesso verifica:

- che nella sidebar siano visibili tutte le sezioni
- che il torneo attivo sia corretto
- che non ci siano messaggi di errore in alto

---

## 4. Panoramica dellinterfaccia

### 4.1 Layout generale

Linterfaccia desktop e composta da:

- barra laterale sinistra con menu di navigazione
- area principale a destra con la pagina attiva

Su mobile la navigazione principale e nel menu inferiore.

![Screenshot 01 - Dashboard](./images/manuale/01-dashboard-principale.png)

*Figura 1 - Vista generale dashboard e menu laterale.*

### 4.2 Menu di navigazione

Le sezioni principali sono:

- Dashboard
- Configurazione
- Squadre
- Gironi
- Calendario
- Risultati
- Bracket Finali
- Export

![Screenshot 02 - Menu laterale](./images/manuale/02-menu-laterale.png)

*Figura 2 - Voci di menu disponibili.*

### 4.3 Selettore torneo attivo

In varie pagine trovi il campo **Torneo attivo**.

Serve a scegliere su quale torneo stai lavorando in quel momento.

E un controllo fondamentale: prima di modificare dati, verifica sempre di essere sul torneo corretto.

### 4.4 Dashboard principale

La Dashboard mostra:

- KPI principali del calendario
- progresso partite giocate
- timeline giornata
- alert violazioni
- stato solver

![Screenshot 03 - KPI dashboard](./images/manuale/03-dashboard-kpi.png)

*Figura 3 - KPI e stato operativo del torneo.*

### 4.5 Messaggi di stato

Nellapp compaiono messaggi contestuali:

- messaggi di successo (salvataggio ok)
- messaggi di errore (dati mancanti o vincoli non rispettati)
- messaggi di caricamento (operazioni in corso)

---

## 5. Guida completa alle funzionalita

### 5.1 Dashboard

### Descrizione

Pagina di controllo rapido per monitorare andamento torneo e qualita della pianificazione.

### Quando usarla

- in apertura giornata
- dopo generazione calendario
- durante inserimento risultati

### Procedura passo passo

1. Apri **Dashboard** dal menu.
2. Seleziona il torneo da **Torneo attivo**.
3. Controlla i KPI principali:
   - Preferenze rispettate
   - Violazioni hard/soft
   - Slot utilizzati
   - Indice equita
4. Verifica il **Progresso torneo** (% partite giocate).
5. Consulta **Timeline Giornata** per partite del giorno.
6. Apri **Alert Violazioni** se ci sono anomalie.
7. Controlla **Stato Solver** (idle/running/done/error).

### Risultato atteso

Ottieni subito lo stato operativo generale senza entrare in ogni singola pagina.

### Suggerimenti

- usa i link negli alert per aprire direttamente la pagina Calendario sul match interessato
- se il solver resta in stato non previsto, usa il pulsante refresh in Calendario

---

### 5.2 Configurazione Torneo

### Descrizione

Wizard completo per creare o modificare la configurazione del torneo.

### Quando usarla

- allinizio della stagione/evento
- quando cambiano giorni, slot o regole
- quando devi creare coppie M/F

![Screenshot 04 - Configurazione wizard](./images/manuale/04-configurazione-wizard.png)

*Figura 4 - Wizard configurazione in 4 step.*

### 5.2.1 Creare un nuovo torneo o una coppia M/F

1. Apri **Configurazione**.
2. Nel toggle seleziona **Nuovo torneo**.
3. Se vuoi creazione doppia, attiva **Crea coppia tornei M/F**.
4. Compila i campi base (nome, anno, numero giorni, durata match, buffer).
5. Procedi con i pulsanti **Avanti** step per step.
6. Concludi con:
   - **Crea coppia M/F** (modalita coppia)
   - oppure **Salva torneo** (singolo)

### 5.2.2 Modificare un torneo esistente

1. Seleziona il torneo da **Torneo attivo**.
2. Passa il toggle su **Modifica torneo**.
3. Attendi il caricamento configurazione.
4. Cambia i dati necessari.
5. Salva con **Aggiorna torneo**.

### 5.2.3 Step 1 - Info Base

Campi principali:

- Nome torneo
- Anno
- Modalita coppia M/F oppure singolo
- Max squadre (M/F separato in coppia)
- Numero giorni torneo
- Durata match (min)
- Buffer tra match (min)
- Finals Days (giorni marcati come finali)

Risultato: definisci la struttura generale del torneo.

### 5.2.4 Step 2 - Fasce Orarie

Per ogni giorno imposti:

- data
- etichetta giorno
- flag giorno finali
- una o piu finestre orarie

Per ogni finestra vedi anche quanti slot verranno generati.

Procedura consigliata:

1. Inserisci data e label giorno.
2. Imposta ora inizio/fine della finestra.
3. Aggiungi finestre con **Aggiungi fascia oraria** se necessario.
4. Controlla il blocco **Slot totali del giorno**.

Risultato: il sistema prepara gli slot disponibili per la pianificazione.

### 5.2.5 Step 3 - Formato

Configuri:

- squadre per girone
- squadre che avanzano
- wild card abilitata
- numero wild card (campo configurazione)
- punti vittoria/pareggio/sconfitta
- ordine criteri spareggio (drag and drop)

Nota operativa finali:

- passano sempre le prime 2 di ogni girone
- il sistema completa i posti finali con le migliori wild card necessarie
- classifica wild card: stessi criteri spareggio, ma senza scontro diretto

Regole finali attive:

- Maschile: target 8 squadre, passa automaticamente a 16 se le qualificate dirette superano 8
- Femminile: target bloccato a 4 squadre

### 5.2.6 Step 4 - Pesi Penalita

Puoi regolare i pesi usati dal solver calendario:

- Preferenza Giorno
- Preferenza Fascia
- Consecutivita
- Riposo Minimo
- Equita Oraria
- Finals Day

Risultato: controlli quanto il solver deve privilegiare ciascuna preferenza.

### 5.2.7 Eliminazioni

Dalla stessa pagina puoi usare:

- **Elimina torneo** per eliminare solo il torneo corrente
- **Elimina coppia M/F** per eliminare entrambi i tornei della coppia

Usa questa funzione con cautela: elimina dati collegati.

### Suggerimenti

- imposta subito i Finals Days corretti: semplifica il lavoro del solver
- usa nomi coerenti (es. stessa base nome + anno) per facilitare la gestione coppie
- prima di salvare controlla il pannello **Riepilogo** a destra

---

### 5.3 Gestione Squadre

### Descrizione

Pagina per creare, modificare, eliminare e importare squadre.

### Quando usarla

- dopo configurazione torneo
- quando arrivano nuove iscrizioni
- quando cambiano preferenze/disponibilita

![Screenshot 05 - Pagina squadre](./images/manuale/05-squadre-lista-e-drawer.png)

*Figura 5 - Lista squadre e drawer di creazione/modifica.*

### 5.3.1 Aggiungere una squadra manualmente

1. Apri **Squadre**.
2. Scegli ledizione (coppia) nel selettore.
3. Clicca **Aggiungi squadra**.
4. Nel drawer inserisci:
   - Nome squadra
   - Genere (in creazione)
   - Giorni preferiti
   - Fasce orarie preferite
   - Slot indisponibili
   - Preferenza partite consecutive
5. Clicca **Crea squadra**.

Risultato atteso: la squadra appare subito nella griglia.

### 5.3.2 Modificare una squadra

1. Clicca **Modifica** sulla card squadra.
2. Aggiorna i campi necessari.
3. Clicca **Salva modifiche**.

Nota: in modifica il genere non e editabile.

### 5.3.3 Eliminare una squadra

1. Clicca **Elimina** sulla card.
2. Conferma la richiesta.

Risultato: squadra rimossa dal torneo.

### 5.3.4 Importazione CSV

1. Clicca **Import CSV**.
2. Scegli target import (Maschile o Femminile).
3. Scarica il modello con **Template CSV**.
4. Trascina il file CSV nellarea import.
5. Controlla anteprima righe.
6. Clicca **Conferma import**.

Risultato atteso: squadre importate e visibili nella lista.

### 5.3.5 Interpretazione vincoli squadra

- Giorni/Fasce preferite: vincoli soft (il solver prova a rispettarli)
- Slot indisponibili: vincolo hard (non verranno mai usati)
- Preferisce consecutive: preferenza soft

### Suggerimenti

- usa il CSV per grandi volumi di iscrizioni
- imposta indisponibilita solo quando davvero necessarie
- controlla i contatori M/F per non superare il massimo squadre

---

### 5.4 Gestione Gironi

### Descrizione

Genera i gironi automaticamente e permette aggiustamenti manuali.

### Quando usarla

- dopo aver completato le squadre
- prima di pianificare il calendario

![Screenshot 06 - Pagina gironi](./images/manuale/06-gironi-e-compatibilita.png)

*Figura 6 - Gironi auto-generati e matrice compatibilita oraria.*

### 5.4.1 Generare o rigenerare gironi

1. Apri **Gironi**.
2. Seleziona coppia tornei.
3. Seleziona tab **Maschile** o **Femminile**.
4. Clicca **Rigenera**.

Risultato: il sistema crea gruppi e match round-robin.

### 5.4.2 Modifica manuale gironi

1. Clicca **Modifica manuale**.
2. Trascina le squadre tra i gironi (drag and drop).
3. Clicca **Salva modifiche**.

Se cambi idea, usa **Annulla modifica**.

Risultato: composizione gironi aggiornata e partite rigenerate per il girone modificato.

### 5.4.3 Matrice compatibilita oraria

Mostra la compatibilita teorica tra squadre in base alle disponibilita.

Interpretazione rapida:

- valore alto: squadre piu compatibili
- valore basso: possibili difficolta di pianificazione

### Suggerimenti

- dopo modifiche manuali, passa subito in Calendario per verificare impatto
- evita gruppi con troppe squadre molto incompatibili tra loro

---

### 5.5 Gestione Calendario

### Descrizione

Sezione centrale per generazione automatica calendario e modifica manuale slot.

### Quando usarla

- dopo la creazione dei gironi
- ogni volta che cambi indisponibilita o struttura giorni

![Screenshot 07 - Calendario giorno](./images/manuale/07-calendario-vista-giorno.png)

*Figura 7 - Vista giorno con slot, partite schedulate e non schedulate.*

### 5.5.1 Generare il calendario con solver

1. Apri **Calendario**.
2. Seleziona il **Torneo attivo**.
3. Se vuoi evitare sovrapposizioni con altro torneo (stesso campo), seleziona i tornei in **Pianifica insieme a**.
4. Clicca **Genera calendario**.
5. Attendi stato solver.
6. Clicca **Applica soluzione** per salvare lassegnazione proposta.

Risultato atteso: partite assegnate agli slot disponibili.

### 5.5.2 KPI qualita calendario

Nel pannello trovi:

- Pianificate / Totali
- Non pianificate
- Hard viol.
- Soft viol.
- Preferenze rispettate

Usa **Dettaglio violazioni** per vedere i motivi match per match.

### 5.5.3 Modifica manuale incroci e orari

1. Passa alla **Vista Giorno**.
2. Trascina una partita su uno slot libero.
3. Se il match e bloccato, prima usa **Unlock**.
4. Se vuoi fissare definitivamente una partita, usa **Lock**.

Note operative:

- in modifica manuale puoi fare scelte non ottimali rispetto alle preferenze
- il sistema ti mostra i warning, ma puoi comunque organizzare il calendario secondo esigenze reali
- non puoi assegnare due partite allo stesso slot

### 5.5.4 Viste alternative

- **Vista Giorno**: calendario completo per fascia oraria
- **Vista Squadra**: tutte le partite della squadra selezionata
- **Vista Girone**: tutte le partite del girone selezionato

### 5.5.5 Uso condiviso M/F su campo unico

Per evitare match contemporanei tra i due tornei:

1. apri torneo A
2. in **Pianifica insieme a** seleziona torneo B
3. genera e applica

In questo modo il solver considera insieme gli orari e impedisce sovrapposizioni sulla stessa fascia data/ora.

### Suggerimenti

- prima genera automaticamente, poi rifinisci a mano
- usa lock solo sui match veramente vincolati
- controlla sempre le partite non schedulate prima di chiudere il piano

---

### 5.6 Risultati, Classifiche e Marcatori

### Descrizione

Sezione per registrare risultati e aggiornare classifiche in tempo reale.

### Quando usarla

- durante e dopo ogni partita
- per monitorare qualificate e marcatori

![Screenshot 08 - Risultati e classifiche](./images/manuale/08-risultati-classifiche.png)

*Figura 8 - Classifica girone/wild card e inserimento risultati.*

### 5.6.1 Selezione contesto

1. Seleziona **Torneo attivo**.
2. Scegli tab **Maschile** o **Femminile**.
3. Scegli filtro visuale (Girone, Squadra, Giorno).

### 5.6.2 Classifica gironi

- seleziona il girone dalle tab in alto
- leggi posizione, punti, differenza reti, statistiche

### 5.6.3 Classifica Wild Card

Tab **Wild Card**: confronto tra seconde classificate dei gironi (ordinamento per punti, differenza reti, gol fatti).

### 5.6.4 Inserire risultato partita

1. Nella card match inserisci gol casa/trasferta.
2. Inserisci falli delle due squadre.
3. Se serve usa **Reset** falli.
4. Clicca **Salva**.

Risultato atteso: partita marcata come giocata e classifica aggiornata.

### 5.6.5 Gestione marcatori

Per ogni match, nel pannello **Marcatori** puoi:

- aprire elenco marcatori partita
- aggiungere un gol (con gestione autogol)
- eliminare un marcatore inserito

La classifica marcatori si aggiorna automaticamente.

### 5.6.6 Unifica alias marcatori

Se lo stesso giocatore e stato inserito con nomi diversi:

1. clicca **Unifica alias**
2. scegli la squadra
3. seleziona i nomi da unificare
4. inserisci nome corretto
5. conferma

Risultato: storico gol consolidato su un unico nome.

### Suggerimenti

- salva i risultati subito dopo la gara
- usa nomi marcatore coerenti sin dalla prima partita
- fai un controllo rapido classifica wildcard a fine giornata

---

### 5.7 Bracket Finali

### Descrizione

Gestione tabellone finale maschile e femminile con propagazione vincitori.

### Quando usarla

- a gironi chiusi (modalita standard)
- anche prima della chiusura, in modalita provvisoria

![Screenshot 09 - Bracket finali](./images/manuale/09-bracket-finali.png)

*Figura 9 - Tabellone finali M/F con turni e finale 3 posto.*

### 5.7.1 Generazione automatica

1. Apri **Bracket Finali**.
2. Seleziona torneo attivo.
3. Nella colonna M o F clicca **Rigenera** (se gironi chiusi).

Regole principali applicate:

- passano sempre le prime 2 di ogni girone
- wildcard: passano le migliori necessarie per completare il target
- Maschile: target 8, oppure 16 se le dirette superano 8
- Femminile: target fisso 4 (se superato, generazione bloccata)
- vincolo accoppiamenti primo turno: prima vs seconda di altro girone, evitando stesso girone quando possibile

### 5.7.2 Generazione provvisoria (gironi non chiusi)

Se i gironi non sono conclusi puoi usare:

- **Genera ora (parziale)**

Oppure modalita manuale.

Il bracket generato in questa fase e da considerare provvisorio.

### 5.7.3 Modalita manuale

1. Clicca **Manuale** nella colonna M o F.
2. Seleziona le squadre da inserire.
3. Conferma con **Genera con N squadre**.

Utile quando vuoi massima flessibilita organizzativa.

### 5.7.4 Avanzamento vincitori

Nelle card partita puoi selezionare la squadra vincente.

Il sistema:

- marca il match come completato
- propaga il vincitore al turno successivo
- propaga il perdente verso la finale 3 posto quando previsto

### 5.7.5 Finale 3 posto

Il tabellone include la **Finale 3 posto**.

E alimentata dai perdenti delle semifinali.

### Suggerimenti

- se hai fatto un bracket provvisorio, rigeneralo a gironi chiusi
- se emergono vincoli logistici reali, usa la modalita manuale
- valida sempre il tabellone prima della comunicazione ufficiale

---

### 5.8 Export dati

### Descrizione

Esporta calendario e riepiloghi in formato CSV e PDF, oppure stampa diretta.

### Quando usarla

- prima di condividere programma partite
- a fine giornata per report
- a fine torneo per archivio

![Screenshot 10 - Export](./images/manuale/10-export.png)

*Figura 10 - Selezione scope e pulsanti export.*

### 5.8.1 Selezione scope export

Puoi scegliere:

- Tutto il torneo
- Solo Maschile
- Solo Femminile
- Per squadra
- Per giorno

Se scegli per squadra/giorno, appare il filtro dedicato.

### 5.8.2 Esporta CSV

1. imposta scope
2. clicca **Esporta CSV**
3. attendi download automatico

Output: file tabellare per Excel/Google Sheets.

### 5.8.3 Esporta PDF

1. imposta scope
2. clicca **Esporta PDF**
3. attendi download automatico

Output: documento pronto per stampa/condivisione.

Nota: con filtri molto specifici (per squadra/per giorno) il PDF privilegia il calendario filtrato.

### 5.8.4 Stampa

Usa **Stampa** per aprire la stampa browser del contenuto attuale.

### Suggerimenti

- usa CSV per analisi dati
- usa PDF per condivisione ufficiale a squadre/staff
- nomina e archivia i file export per data

---

## 6. Suggerimenti e buone pratiche

### 6.1 Ordine operativo consigliato

1. Configurazione torneo
2. Inserimento squadre
3. Generazione gironi
4. Generazione calendario
5. Correzioni manuali calendario
6. Inserimento risultati live
7. Generazione bracket finali
8. Export finale

### 6.2 Buone pratiche di pianificazione

- seleziona sempre il torneo corretto prima di modificare
- usa la pianificazione condivisa M/F quando il campo e unico
- controlla le violazioni dopo ogni generazione
- blocca (Lock) solo gli incontri realmente non spostabili

### 6.3 Buone pratiche sui dati

- evita nomi squadra duplicati o troppo simili
- usa naming consistente per marcatori
- salva spesso durante la compilazione risultati

### 6.4 Errori comuni da evitare

- dimenticare di applicare la soluzione dopo la generazione solver
- lavorare sul torneo sbagliato nel selettore attivo
- ignorare partite non schedulate prima di pubblicare il calendario
- non rigenerare il bracket dopo modifiche importanti ai risultati

---

## 7. Problemi comuni e soluzioni

### 7.1 Un dato non viene salvato

Possibili cause:

- campo obbligatorio mancante
- valore non valido (es. orario fine prima di inizio)
- torneo non selezionato

Cosa fare:

1. controlla il messaggio rosso in alto pagina
2. correggi i campi evidenziati
3. salva di nuovo

### 7.2 Il calendario non cambia dopo Genera calendario

Possibili cause:

- solver ancora in esecuzione
- soluzione non ancora applicata

Cosa fare:

1. attendi stato solver **done/optimal**
2. clicca **Applica soluzione**
3. usa **Refresh**

### 7.3 Non riesco a spostare una partita manualmente

Possibili cause:

- partita in stato Lock
- slot di destinazione occupato

Cosa fare:

1. usa **Unlock** sulla partita
2. scegli uno slot libero
3. ripeti il drag and drop

### 7.4 Bracket non generabile

Possibili cause:

- fase a gironi non chiusa
- femminile con qualificate dirette > 4
- wildcard insufficienti per completare il target

Cosa fare:

1. completa o correggi i risultati gironi
2. usa modalita **Genera ora (parziale)** se serve un bracket provvisorio
3. usa modalita **Manuale** per configurazioni eccezionali

### 7.5 Export PDF non disponibile

Possibile causa:

- dipendenza PDF non presente nel backend

Cosa fare:

1. prova prima **Esporta CSV**
2. verifica configurazione server con il supporto tecnico

### 7.6 Verifica rapida dati inseriti

Checklist veloce:

1. in **Gironi** controlla composizione squadre
2. in **Calendario** verifica assenza non schedulate
3. in **Risultati** controlla classifica e tab wildcard
4. in **Bracket Finali** valida accoppiamenti
5. fai un export CSV/PDF di controllo

---

## 8. Appendice screenshot consigliati

Per completare il manuale con immagini reali, prepara questi file in:

`docs/images/manuale/`

- `01-dashboard-principale.png`
- `02-menu-laterale.png`
- `03-dashboard-kpi.png`
- `04-configurazione-wizard.png`
- `05-squadre-lista-e-drawer.png`
- `06-gironi-e-compatibilita.png`
- `07-calendario-vista-giorno.png`
- `08-risultati-classifiche.png`
- `09-bracket-finali.png`
- `10-export.png`

Raccomandazioni per gli screenshot:

- usa dati realistici ma non sensibili
- mantieni la stessa risoluzione per uniformita
- cattura sempre larea completa con titolo pagina visibile

---

Fine manuale.
