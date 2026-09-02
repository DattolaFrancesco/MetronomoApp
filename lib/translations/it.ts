// Italian strings — typed against en.ts's exact shape (`typeof en`), so
// TypeScript fails to compile if a key present there is missing here. See
// lib/i18n.tsx for how these are looked up at runtime.

import type { en } from "./en";

export const it: typeof en = {
  common: {
    subdivision: {
      quarter: "Quarti",
      eighth: "Ottavi",
      triplet: "Terzine",
      sixteenth: "Sedicesimi",
    },
    status: {
      onTime: "IN TEMPO",
      early: "ANTICIPO",
      late: "RITARDO",
    },
    timingAnalysis: "Analisi del timing",
    start: "Avvia",
    stop: "Ferma",
    goBack: "Torna indietro",
    retry: "Riprova",
  },
  tourButtons: {
    next: "Avanti",
    back: "Indietro",
    skip: "Salta",
    done: "Fine",
  },
  setup: {
    trainingTab: "Allenamento",
    challengeTab: "Sfida",
    microphone: "Microfono",
    tap: "Tocco",
    bars: "Battute",
    tempo: "Suddivisione",
    start: "Avvia",
  },
  home: {
    noteToEvaluate: "Nota da valutare",
    tolerance: "Tolleranza",
    ready: "PRONTO",
    listening: "IN ASCOLTO",
  },
  settings: {
    title: "Impostazioni",
    language: {
      sectionTitle: "Lingua",
      english: "English",
      italian: "Italiano",
    },
    tutorials: {
      sectionTitle: "Tutorial",
      replayMain: "Rivedi il tutorial principale",
      replayChallenge: "Rivedi il tutorial delle sfide",
    },
  },
  mainTour: {
    setupBars: {
      title: "Battute",
      description:
        "Per quante battute dura la sessione — il metronomo si ferma da solo una volta terminate.",
    },
    setupSubdivision: {
      title: "Suddivisione",
      description:
        "Quale suddivisione ritmica allenare — quarti, ottavi, terzine o sedicesimi.",
    },
    setupInputMode: {
      title: "Microfono o Tocco",
      description:
        "Il microfono ascolta i colpi reali attraverso il microfono del dispositivo. Il Tocco permette di allenarsi premendo un pulsante — nessun microfono necessario.",
    },
    setupStart: {
      title: "Avvia",
      description: "Avvia il metronomo con un breve conteggio d'ingresso, poi inizia a monitorare il tuo timing.",
    },
    sessionBeatIndicator: {
      title: "Indicatore del battito",
      description:
        "Questi puntini pulsano in tempo reale con il battito del metronomo, così puoi seguire il tempo anche visivamente.",
    },
    sessionStop: {
      title: "Ferma",
      description: "Ferma la sessione in qualsiasi momento — non devi aspettare che finisca da sola.",
    },
    reportResult: {
      title: "Risultato",
      description: "Il numero principale della sessione — la percentuale di colpi arrivati in tempo.",
    },
    reportStatus: {
      title: "Anticipo, in tempo, ritardo",
      description:
        "Lo stesso risultato scomposto per come ogni colpo ha sbagliato, quando è successo — in anticipo, in tempo o in ritardo.",
    },
    reportDebugChart: {
      title: "Analisi del timing",
      description: "L'intera forma d'onda confrontata con la griglia del battito — la linea rossa indica esattamente dove è arrivato ogni colpo.",
    },
  },
  challengeTour: {
    list: {
      title: "Sfide",
      description: "Ordinate dalla più facile alla più difficile, dall'alto verso il basso.",
    },
    difficultyBadge: {
      title: "Difficoltà",
      description:
        "Facile, Medio, Difficile, Expert — i livelli più alti richiedono suddivisioni più numerose (o più insidiose) e una tolleranza di timing più stretta.",
    },
    cardFirst: {
      title: "Una sfida",
      description: "Tocca una scheda per vederne i dettagli e iniziarla.",
    },
    tolerance: {
      title: "Tolleranza",
      description: "Quanto ogni colpo deve avvicinarsi al battito per essere valido — più stretta nelle sfide più difficili.",
    },
  },
  challengeScreen: {
    difficulty: {
      facile: "Facile",
      medio: "Medio",
      difficile: "Difficile",
      expert: "Expert",
    },
    title: "Sfida",
    masteryBanner: "Sei un Timing Master",
    view: "Vedi",
    toleranceLabel: "±{{ms}}ms di tolleranza",
    report: {
      passedTitle: "Fantastico!",
      failedTitle: "Quasi!",
      passedSubtitle: "Tutti i {{count}} colpi erano in tempo.",
      failedSubtitle: "Non tutti i colpi erano in tempo — riprova!",
      onTimeCount: "{{onTime}} su {{total}} in tempo",
      barLabel: "Battuta {{n}} — {{label}}",
      missed: "mancato",
    },
  },
  sessionReport: {
    title: "Report della sessione",
    result: "Risultato",
    noHits: "Nessun colpo rilevato in questa sessione.",
    onTimeCount: "{{onTime}} su {{total}} colpi in tempo",
    newSession: "Nuova sessione",
  },
  syncRecorder: {
    inputAudio: "Audio in ingresso",
    micNotAuthorized: "Microfono non autorizzato. Abilita l'accesso nelle impostazioni per vedere la sincronizzazione.",
    tip: "Suggerimento: usa cuffie o auricolari per un rilevamento più preciso — questo evita che il microfono capti anche il click del metronomo.",
  },
  tapRecorder: {
    inputTap: "Tocco in ingresso",
    soundToggle: "Suono",
    tap: "Tocca",
    tapsCount: "{{count}} tocchi",
    hintArmed: "Tocca il pulsante a tempo con il metronomo.",
    hintIdle: "Tocca il pulsante per iniziare — nessun microfono necessario.",
  },
  wiredHeadphonesNotice: {
    title: "Per risultati accurati, usa cuffie con cavo",
    body: "Questa app misura il tuo timing al millisecondo. Le cuffie Bluetooth aggiungono un ritardo audio che falsa la misurazione — anche un buon paio può sfasare di 100ms o più. Per risultati precisi, usa cuffie con cavo. Questo evita anche che il microfono capti il click del metronomo.",
    dontShowAgain: "Non mostrare più",
    gotIt: "Ho capito",
  },
  micPermissionGate: {
    title: "Accesso al microfono richiesto",
    body: "Timing confronta il tuo timing con il metronomo usando il microfono. Devi concedere l'accesso per continuare.",
    allowAccess: "Consenti l'accesso",
    openSettings: "Apri le impostazioni",
    useTapInstead: "Usa il Tocco invece — nessun microfono necessario",
  },
  debugChart: {
    description: {
      tap: {
        triplet:
          "Le linee bianche numerate indicano i quarti (il battere), le linee più sottili le due suddivisioni della terzina. Ogni linea è un tocco — verde se in tempo, rossa se fuori tolleranza.",
        sixteenth:
          "Le linee bianche numerate indicano i quarti (il battere), le linee più sottili i tre sedicesimi interni. Ogni linea è un tocco — verde se in tempo, rossa se fuori tolleranza.",
        default:
          "Le linee bianche numerate indicano i quarti, i trattini brevi i sedicesimi. Ogni linea è un tocco — verde se in tempo, rossa se fuori tolleranza.",
      },
      mic: {
        triplet:
          "Le linee bianche numerate indicano i quarti (il battere), le linee più sottili le due suddivisioni della terzina. La linea rossa continua è il picco rilevato dal microfono.",
        sixteenth:
          "Le linee bianche numerate indicano i quarti (il battere), le linee più sottili i tre sedicesimi interni. La linea rossa continua è il picco rilevato dal microfono.",
        default:
          "Le linee bianche numerate indicano i quarti, i trattini brevi i sedicesimi. La linea rossa continua è il picco rilevato dal microfono.",
      },
    },
    legend: {
      quarter: "quarto",
      tripletSubdivisions: "suddivisioni della terzina",
      innerSixteenths: "sedicesimi interni",
      onTime: "in tempo",
      outOfTolerance: "fuori tolleranza",
      hit: "colpo",
    },
    barLabel: "Battuta {{n}}",
  },
  debugHitTable: {
    description:
      "Per ogni quarto: esito, il picco più forte trovato nella finestra di ascolto, e quanto è salito rispetto al minimo precedente — confrontato con le soglie minime (ampiezza {{amplitude}}, salita {{rise}}).",
    barLabel: "Battuta {{n}}",
    notDetected: "NON RILEVATO",
    peak: "picco",
    rise: "salita",
  },
  challenges: {
    "battere-poi-levare": {
      name: "Battere → Levare",
      description: "Una battuta sul battere (i quarti), poi subito una battuta sul levare (gli ottavi in levare).",
    },
    "levare-poi-battere": {
      name: "Levare → Battere",
      description: "Stessa coppia della sfida precedente, ma invertita: prima il levare, poi subito il battere.",
    },
    "battere-levare-battere": {
      name: "Battere → Levare → Battere",
      description: "Tre battute di fila: una sul battere, poi una sul levare, poi di nuovo sul battere.",
    },
    "battere-poi-sedicesimo2": {
      name: "Battere → 2° Sedicesimo",
      description: "Una battuta sul battere (i quarti), poi subito una battuta sul secondo sedicesimo di ogni quarto.",
    },
    "battere-poi-terzina3": {
      name: "Battere → 3ª Terzina",
      description: "Una battuta sul battere (i quarti), poi subito una battuta sulla terza nota di ogni terzina.",
    },
    "sedicesimo2-battere-sedicesimo4": {
      name: "2° Sedicesimo → Battere → 4° Sedicesimo",
      description: "Tre battute di fila: il secondo sedicesimo di ogni quarto, poi il battere, poi il quarto sedicesimo.",
    },
    "levare-poi-sedicesimo2": {
      name: "Levare → 2° Sedicesimo",
      description: "Una battuta sul levare (gli ottavi in levare), poi subito una battuta sul secondo sedicesimo di ogni quarto.",
    },
    "giro-sedicesimi": {
      name: "1° → 2° → 3° → 4° Sedicesimo",
      description:
        "Quattro battute di fila, una per ogni posizione del sedicesimo all'interno del movimento: prima il battere, poi il secondo, il terzo e il quarto sedicesimo in successione.",
    },
    "doppia-alternanza-levare": {
      name: "Alternanza Sedicesimo/Battere → Levare → Alternanza Sedicesimo/Levare",
      description:
        "Tre battute: la prima alterna il secondo sedicesimo e il battere a ogni quarto, la seconda è tutta sul levare, la terza alterna il quarto sedicesimo e il levare a ogni quarto.",
    },
    "battere-levare-terzina3": {
      name: "Battere → Levare → 3ª Terzina",
      description: "Tre battute di fila, ciascuna con una suddivisione diversa: quarti, poi levare, poi la terza nota della terzina.",
    },
    "alternanza-battuta": {
      name: "Alternanza in una battuta",
      description:
        "Una singola battuta: il 1° e il 3° quarto si suonano sul battere, il 2° e il 4° sul secondo sedicesimo — il cambio di suddivisione avviene all'interno della stessa battuta.",
    },
  },
};
