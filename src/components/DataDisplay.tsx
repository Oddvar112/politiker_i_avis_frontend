import { DataDTO, SammendragDTO, DateRange, ArtikelDTO, SentimentLabel, Person } from "@/types/api";
import { useState, useEffect } from "react";
import { kvasirApi } from "../services/kvasirApi";
import React from "react";

interface DataDisplayProps {
  data: DataDTO | null;
  isLoading: boolean;
  error: string | null;
  dateRange: DateRange;
  onDateRangeChange: (dateRange: DateRange) => void;
  onResetDateFilter: () => void;
}

// === Sentiment-hjelpere ===
//
// Bakenden lagrer nå alle tre konfidensene fra modellen (negativ, nøytral,
// positiv). Frontenden speiler den logikken eksakt: argmax over de tre tallene
// avgjør label, både per artikkel og som kandidat-snitt. Ingen egne terskler.

type SentimentVec = { neg: number; neutral: number; pos: number };

function sentimentMeta(label: SentimentLabel | null | undefined) {
  switch (label) {
    case "POSITIV":
      return { text: "Positiv", cls: "kv-sentiment kv-sentiment-positive", icon: "▲" };
    case "NEGATIV":
      return { text: "Negativ", cls: "kv-sentiment kv-sentiment-negative", icon: "▼" };
    case "NOYTRAL":
      return { text: "Nøytral", cls: "kv-sentiment kv-sentiment-neutral", icon: "■" };
    default:
      return null;
  }
}

/**
 * Argmax over (negativ, nøytral, positiv) — eksakt samme regel som
 * `SentimentScore.sentiment()` på backend-siden. Hvis alle tre mangler
 * returneres null.
 */
function pickLabel(v: SentimentVec | null): SentimentLabel | null {
  if (v === null) return null;
  if (v.neutral >= v.neg && v.neutral >= v.pos) return "NOYTRAL";
  return v.pos > v.neg ? "POSITIV" : "NEGATIV";
}

function vecFromScores(
  positive: number | null,
  neutral: number | null,
  negative: number | null
): SentimentVec | null {
  if (positive === null || neutral === null || negative === null) return null;
  return { neg: negative, neutral, pos: positive };
}

function hasSentiment(a: ArtikelDTO): boolean {
  return !!(a.girSentiment || a.faarSentiment);
}

/**
 * Snittet av konfidensvektoren over alle artikler som har sentiment-scorer
 * for den aktuelle dimensjonen ('faar' = omtalt av andre, 'gir' = sier om
 * andre). Argmax over snittvektoren gir kandidatens samlede label — samme
 * regel som per-artikkel-pillen, så de kan ikke være uenige.
 */
function aggregateScores(
  person: Person,
  kind: 'faar' | 'gir'
): { vec: SentimentVec; count: number } {
  const scored = person.lenker.filter(l => {
    const pos = kind === 'faar' ? l.faarPositivScore : l.girPositivScore;
    const neg = kind === 'faar' ? l.faarNegativScore : l.girNegativScore;
    const neu = kind === 'faar' ? l.faarNoytralScore : l.girNoytralScore;
    return pos !== null && neg !== null && neu !== null;
  });
  if (scored.length === 0) {
    return { vec: { neg: 0, neutral: 0, pos: 0 }, count: 0 };
  }
  const sum = scored.reduce(
    (acc, l) => {
      acc.pos += (kind === 'faar' ? l.faarPositivScore : l.girPositivScore) || 0;
      acc.neg += (kind === 'faar' ? l.faarNegativScore : l.girNegativScore) || 0;
      acc.neutral += (kind === 'faar' ? l.faarNoytralScore : l.girNoytralScore) || 0;
      return acc;
    },
    { pos: 0, neg: 0, neutral: 0 }
  );
  return {
    vec: {
      neg: sum.neg / scored.length,
      neutral: sum.neutral / scored.length,
      pos: sum.pos / scored.length,
    },
    count: scored.length,
  };
}

// === Små komponenter ===
function SentimentPill({ label }: { label: SentimentLabel | null | undefined }) {
  const meta = sentimentMeta(label);
  if (!meta) return null;
  return (
    <span className={meta.cls} title={`Sentiment: ${meta.text}`}>
      <span aria-hidden>{meta.icon}</span>
      {meta.text}
    </span>
  );
}

/**
 * Tre stablede mini-barer — én per dimensjon (negativ / nøytral / positiv).
 * Hver rad har label, en horisontal stolpe i dimensjonens farge, og prosenten
 * helt til høyre. Klarere enn én sammensatt stolpe fordi alle tre verdiene
 * leses direkte uten at man må sammenligne segmenter mot hverandre.
 */
function SentimentBar({ vec }: { vec: SentimentVec | null }) {
  if (vec === null) return null;
  const dimensions = [
    {
      key: 'neg',
      label: 'Negativ',
      value: vec.neg,
      fillClass: 'bg-rose-500',
      textClass: 'text-rose-600 dark:text-rose-400',
    },
    {
      key: 'neu',
      label: 'Nøytral',
      value: vec.neutral,
      fillClass: 'bg-gray-400 dark:bg-gray-500',
      textClass: 'text-gray-500 dark:text-gray-400',
    },
    {
      key: 'pos',
      label: 'Positiv',
      value: vec.pos,
      fillClass: 'bg-emerald-500',
      textClass: 'text-emerald-600 dark:text-emerald-400',
    },
  ] as const;
  return (
    <div className="space-y-1 w-full">
      {dimensions.map(d => {
        const pct = Math.max(0, Math.min(100, d.value * 100));
        return (
          <div
            key={d.key}
            className="flex items-center gap-2 text-[10px] font-semibold tabular-nums"
            title={`${d.label}: ${pct.toFixed(0)}%`}
          >
            <span className={`min-w-[44px] ${d.textClass}`}>{d.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-gray-200/60 dark:bg-gray-700/60 overflow-hidden">
              <div
                className={`h-full rounded-full ${d.fillClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`min-w-[28px] text-right ${d.textClass}`}>
              {pct.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SentimentRow({
  heading,
  label,
  positive,
  neutral,
  negative,
  help
}: {
  heading: string;
  label: SentimentLabel | null;
  positive: number | null;
  neutral: number | null;
  negative: number | null;
  help: string;
}) {
  if (!label && positive === null && neutral === null && negative === null) return null;
  const vec = vecFromScores(positive, neutral, negative);
  // Speiler backend-argmax når vi har alle tre scorer; faller tilbake til
  // backend-labelen kun hvis noen av dem mangler.
  const visningsLabel = pickLabel(vec) ?? label;
  return (
    <div className="space-y-1.5">
      {/*
        Mobil: heading + pill stables vertikalt så lange headings kan
        bryte naturlig uten å skvise pillen.
        sm+: side-om-side med justify-between.
      */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 leading-snug">
            {heading}
          </span>
          <span
            className="text-[10px] text-gray-400 dark:text-gray-500 cursor-help flex-shrink-0 mt-0.5"
            title={help}
          >
            ⓘ
          </span>
        </div>
        <div className="flex-shrink-0">
          <SentimentPill label={visningsLabel} />
        </div>
      </div>
      <SentimentBar vec={vec} />
    </div>
  );
}

function ArticlePreview({ url }: { url: string }) {
  const getDomainInfo = (url: string) => {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain.includes('vg.no')) return { name: 'VG', color: 'bg-red-600', logo: '/bilder/vg.png' };
      if (domain.includes('nrk.no')) return { name: 'NRK', color: 'bg-blue-600', logo: '/bilder/NRK.png' };
      if (domain.includes('e24.no')) return { name: 'E24', color: 'bg-green-600', logo: '/bilder/E42.png' };
      if (domain.includes('dagbladet.no')) return { name: 'DB', color: 'bg-red-500', logo: '/bilder/dagbladet.png' };
      if (domain.includes('aftenposten.no')) return { name: 'AP', color: 'bg-gray-700', logo: null };
      return { name: domain.substring(0, 3).toUpperCase(), color: 'bg-blue-500', logo: null };
    } catch {
      return { name: '?', color: 'bg-gray-500', logo: null };
    }
  };
  const domainInfo = getDomainInfo(url);
  return (
    <div className="w-16 sm:w-24 h-14 sm:h-16 flex-shrink-0 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex items-center justify-center">
      {domainInfo.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={domainInfo.logo}
          alt={`${domainInfo.name} logo`}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className={`w-10 h-10 ${domainInfo.color} rounded-full flex items-center justify-center text-white text-sm font-bold`}>
            {domainInfo.name}
          </div>
        </div>
      )}
    </div>
  );
}

function ArticleWithSummary({
  artikkel,
  index
}: {
  artikkel: ArtikelDTO;
  index: number;
}) {
  const [sammendrag, setSammendrag] = useState<SammendragDTO | null>(null);
  const [showSammendrag, setShowSammendrag] = useState(false);
  const [isLoadingSammendrag, setIsLoadingSammendrag] = useState(false);
  const [sammendragError, setSammendragError] = useState<string | null>(null);

  const handleSammendragClick = async () => {
    if (showSammendrag) {
      setShowSammendrag(false);
      return;
    }
    if (!sammendrag && !isLoadingSammendrag) {
      setIsLoadingSammendrag(true);
      setSammendragError(null);
      try {
        const result = await kvasirApi.getSammendrag(artikkel.lenke);
        setSammendrag(result);
        setShowSammendrag(true);
      } catch (error) {
        setSammendragError(error instanceof Error ? error.message : 'Kunne ikke hente sammendrag');
      } finally {
        setIsLoadingSammendrag(false);
      }
    } else {
      setShowSammendrag(true);
    }
  };

  const formatScrapedDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('no-NO', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const sentimentAvailable = hasSentiment(artikkel);

  return (
    <div>
      <div className="kv-card p-3 sm:p-4 flex items-start gap-3">
        <span className="text-xs text-gray-400 mt-1 min-w-[20px] flex-shrink-0 font-mono tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </span>

        <ArticlePreview url={artikkel.lenke} />

        <div className="flex-1 min-w-0 space-y-3">
          <a
            href={artikkel.lenke}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs sm:text-sm text-blue-600 dark:text-blue-400 hover:underline break-all block leading-snug"
          >
            {artikkel.lenke}
          </a>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="kv-badge"
              title="Dato artikkelen ble hentet"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {formatScrapedDate(artikkel.scraped)}
            </span>

            <button
              onClick={handleSammendragClick}
              disabled={isLoadingSammendrag}
              className="kv-badge hover:brightness-110 transition cursor-pointer disabled:opacity-50"
              style={{ background: 'rgba(168, 85, 247, 0.12)', color: '#7c3aed', borderColor: 'rgba(168, 85, 247, 0.25)' }}
            >
              {isLoadingSammendrag ? (
                <>
                  <span className="animate-spin w-3 h-3 border border-current border-t-transparent rounded-full" />
                  Laster…
                </>
              ) : showSammendrag ? 'Skjul sammendrag' : 'Vis sammendrag'}
            </button>

            {!sentimentAvailable && (
              <span className="kv-sentiment kv-sentiment-neutral" title="Sentiment er ikke analysert ennå">
                Sentiment kommer
              </span>
            )}
          </div>

          {sentimentAvailable && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
              <SentimentRow
                heading="Sum av setningssentiment om kandidaten"
                help="Summen av sentimentet i alle setninger i artikkelen der kandidaten er objektet – altså hvordan andre omtaler personen."
                label={artikkel.faarSentiment}
                positive={artikkel.faarPositivScore}
                neutral={artikkel.faarNoytralScore}
                negative={artikkel.faarNegativScore}
              />
              <SentimentRow
                heading="Sum av setningssentiment fra kandidaten"
                help="Summen av sentimentet i alle setninger i artikkelen der kandidaten er subjektet – altså hvordan personen omtaler andre."
                label={artikkel.girSentiment}
                positive={artikkel.girPositivScore}
                neutral={artikkel.girNoytralScore}
                negative={artikkel.girNegativScore}
              />
            </div>
          )}
        </div>
      </div>

      {showSammendrag && (
        <div className="ml-0 sm:ml-10 mt-2 p-3 sm:p-4 kv-card">
          {sammendragError ? (
            <div className="text-red-600 dark:text-red-400 text-sm">
              <span className="font-medium">Feil:</span> {sammendragError}
            </div>
          ) : sammendrag ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="kv-badge">
                  Original: {sammendrag.antallOrdOriginal} ord
                </span>
                <span className="kv-badge" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#059669', borderColor: 'rgba(16, 185, 129, 0.25)' }}>
                  Sammendrag: {sammendrag.antallOrdSammendrag} ord
                </span>
                <span className="kv-badge" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#7c3aed', borderColor: 'rgba(168, 85, 247, 0.25)' }}>
                  Kompresjon: {(sammendrag.kompresjonRatio * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {sammendrag.sammendrag}
              </p>
            </div>
          ) : (
            <div className="text-gray-500 dark:text-gray-400 text-sm">
              Sammendrag ikke tilgjengelig for denne artikkelen.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DateRangeSelector({ dateRange, onDateRangeChange, onResetDateFilter, setShowValidationWarning }: {
  dateRange: DateRange;
  onDateRangeChange: (dateRange: DateRange) => void;
  onResetDateFilter: () => void;
  setShowValidationWarning: (msg: string | null) => void;
}) {
  const minimumDate = kvasirApi.getMinimumDate();
  const today = new Date();

  const formatDateForInput = (date: Date | null): string => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  };

  const isValidDate = (selectedDate: Date): { valid: boolean; message?: string } => {
    const selectedDateOnly = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const minimumDateOnly = new Date(minimumDate.getFullYear(), minimumDate.getMonth(), minimumDate.getDate());
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (selectedDateOnly < minimumDateOnly) {
      return { valid: false, message: `Kan ikke velge dato før ${kvasirApi.formatNorwegianDate(minimumDate)}. Dette er den tidligste datoen vi har data fra.` };
    }
    if (selectedDateOnly > todayOnly) {
      return { valid: false, message: `Kan ikke velge fremtidige datoer. Velg dagens dato eller tidligere.` };
    }
    return { valid: true };
  };

  const handleFromDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) {
      setShowValidationWarning(null);
      onDateRangeChange({ ...dateRange, fraDato: null });
      return;
    }
    const selectedDate = new Date(e.target.value);
    const validation = isValidDate(selectedDate);
    if (!validation.valid) {
      setShowValidationWarning(validation.message || 'Ugyldig dato');
      setTimeout(() => {
        e.target.value = formatDateForInput(dateRange.fraDato || minimumDate);
      }, 100);
      return;
    }
    setShowValidationWarning(null);
    let newTilDato = dateRange.tilDato;
    if (newTilDato && selectedDate > newTilDato) newTilDato = selectedDate;
    onDateRangeChange({ fraDato: selectedDate, tilDato: newTilDato });
  };

  const handleToDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) {
      setShowValidationWarning(null);
      onDateRangeChange({ ...dateRange, tilDato: null });
      return;
    }
    const selectedDate = new Date(e.target.value);
    const validation = isValidDate(selectedDate);
    if (!validation.valid) {
      setShowValidationWarning(validation.message || 'Ugyldig dato');
      setTimeout(() => {
        e.target.value = formatDateForInput(dateRange.tilDato || today);
      }, 100);
      return;
    }
    setShowValidationWarning(null);
    let newFraDato = dateRange.fraDato;
    if (newFraDato && selectedDate < newFraDato) newFraDato = selectedDate;
    onDateRangeChange({ fraDato: newFraDato, tilDato: selectedDate });
  };

  const hasActiveFilter = dateRange.fraDato || dateRange.tilDato;
  const [showCustom, setShowCustom] = useState(false);

  // Helper: lag normalisert dato uten tid
  const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const daysBetween = (a: Date, b: Date) =>
    Math.round((dayOnly(b).getTime() - dayOnly(a).getTime()) / 86400000);

  // Beregn hvilken preset som er aktiv akkurat nå
  const activePreset: string = (() => {
    if (!dateRange.fraDato || !dateRange.tilDato) return 'alle';
    const todayD = dayOnly(today);
    const tilD = dayOnly(dateRange.tilDato);
    const fraD = dayOnly(dateRange.fraDato);
    if (tilD.getTime() !== todayD.getTime()) return 'custom';
    const diff = daysBetween(fraD, todayD);
    if (diff === 0) return 'idag';
    if (diff === 6) return '7d';
    if (diff === 29) return '30d';
    if (diff === 89) return '90d';
    if (fraD.getTime() === dayOnly(minimumDate).getTime()) return 'alle';
    return 'custom';
  })();

  const applyPreset = (key: string) => {
    const todayD = new Date();
    if (key === 'alle') {
      onDateRangeChange({ fraDato: minimumDate, tilDato: todayD });
    } else if (key === 'idag') {
      onDateRangeChange({ fraDato: todayD, tilDato: todayD });
    } else if (key === '7d') {
      const from = new Date(todayD); from.setDate(from.getDate() - 6);
      onDateRangeChange({ fraDato: from, tilDato: todayD });
    } else if (key === '30d') {
      const from = new Date(todayD); from.setDate(from.getDate() - 29);
      onDateRangeChange({ fraDato: from, tilDato: todayD });
    } else if (key === '90d') {
      const from = new Date(todayD); from.setDate(from.getDate() - 89);
      onDateRangeChange({ fraDato: from, tilDato: todayD });
    }
    setShowCustom(false);
    setShowValidationWarning(null);
  };

  const presets: { key: string; label: string }[] = [
    { key: 'idag', label: 'I dag' },
    { key: '7d', label: 'Siste 7 dager' },
    { key: '30d', label: 'Siste 30 dager' },
    { key: '90d', label: 'Siste 3 mnd' },
    { key: 'alle', label: 'Hele perioden' },
  ];

  const rangeLabel = dateRange.fraDato && dateRange.tilDato
    ? `${kvasirApi.formatNorwegianDate(dateRange.fraDato)} – ${kvasirApi.formatNorwegianDate(dateRange.tilDato)}`
    : 'Ingen datofilter';

  return (
    <div className="kv-card p-5 sm:p-6 mb-8 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{ background: 'radial-gradient(600px 200px at 10% 0%, #4f46e5, transparent 60%)' }}
      />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="kv-icon-badge kv-icon-badge-blue flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold tracking-tight">Tidsrom</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {rangeLabel}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCustom(s => !s)}
              className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all flex items-center gap-1.5 shadow-sm ${
                showCustom || activePreset === 'custom'
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                  : 'bg-white/60 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Egendefinert
            </button>
            {hasActiveFilter && activePreset !== 'alle' && (
              <button
                onClick={onResetDateFilter}
                className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-white dark:hover:bg-gray-800 transition-all shadow-sm"
                title="Tilbakestill til hele perioden"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Preset-pills som segmentert kontroll */}
        <div className="flex flex-wrap gap-1.5 p-1 bg-gray-100/70 dark:bg-gray-800/50 rounded-xl border border-gray-200/60 dark:border-gray-700/60">
          {presets.map(p => {
            const active = activePreset === p.key;
            return (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key)}
                className={`flex-1 min-w-[90px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  active
                    ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-foreground hover:bg-white/50 dark:hover:bg-gray-900/50'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Egendefinert dato-panel (collapsible) */}
        {showCustom && (
          <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-gray-200 dark:border-gray-800 animate-fade-in-up">
            <div className="flex-1 flex flex-col gap-1.5">
              <label htmlFor="fraDato" className="text-[10px] uppercase tracking-[0.12em] font-bold text-gray-500 dark:text-gray-400">
                Fra
              </label>
              <input
                id="fraDato"
                type="date"
                value={formatDateForInput(dateRange.fraDato)}
                onChange={handleFromDateChange}
                min={formatDateForInput(minimumDate)}
                max={formatDateForInput(today)}
                className="px-3.5 py-2.5 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-xl bg-white/70 dark:bg-gray-900/70 text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-400 shadow-sm"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label htmlFor="tilDato" className="text-[10px] uppercase tracking-[0.12em] font-bold text-gray-500 dark:text-gray-400">
                Til
              </label>
              <input
                id="tilDato"
                type="date"
                value={formatDateForInput(dateRange.tilDato)}
                onChange={handleToDateChange}
                min={formatDateForInput(dateRange.fraDato || minimumDate)}
                max={formatDateForInput(today)}
                className="px-3.5 py-2.5 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-xl bg-white/70 dark:bg-gray-900/70 text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-400 shadow-sm"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title, value, hint, variant, icon
}: {
  title: string;
  value: React.ReactNode;
  hint?: string;
  variant: "blue" | "green" | "purple" | "amber";
  icon?: React.ReactNode;
}) {
  const variantCls = variant === "green" ? "kv-stat-green"
    : variant === "purple" ? "kv-stat-purple"
    : variant === "amber" ? "kv-stat-amber"
    : "";
  const gradTextCls = variant === "green" ? "kv-grad-text-emerald"
    : variant === "purple" ? "kv-grad-text-purple"
    : variant === "amber" ? "kv-grad-text-amber"
    : "kv-grad-text";
  const iconBadgeCls = variant === "green" ? "kv-icon-badge-emerald"
    : variant === "purple" ? "kv-icon-badge-purple"
    : variant === "amber" ? "kv-icon-badge-amber"
    : "kv-icon-badge-blue";

  return (
    <div className={`kv-card kv-card-hover kv-stat ${variantCls} p-5 sm:p-6 animate-fade-in-up`}>
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[11px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-[0.14em] mb-3">
            {title}
          </h3>
          <p className={`text-4xl sm:text-5xl font-extrabold ${gradTextCls} tabular-nums leading-none`}>
            {value}
          </p>
          {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 font-medium">{hint}</p>}
        </div>
        {icon && (
          <div className={`kv-icon-badge ${iconBadgeCls} flex-shrink-0`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

interface Rikspolitiker {
  id: string;
  fornavn: string;
  etternavn: string;
  parti: string;
  partiId: string;
  tittel: string;      // f.eks. "Statsminister", eller "" for ren representant
  kjoenn: string;
  sortering: number;   // brukes til visning av regjering i rekkefølge
  fylke: string;       // for representanter
  erRegjering: boolean;
  erVara: boolean;
}

type PolitikerFilter = 'regjering' | 'storting' | 'alle';

// Nåværende stortingsperiode — oppdater ved nytt valg
const STORTINGSPERIODE_ID = '2025-2029';

/**
 * Felles oppslagsmodell for politiker-rutene. Bygges ulikt per filter:
 * regjering/storting itererer Stortinget-lista, "alle" itererer DB-personer
 * og slår opp evt. matching rikspolitiker for bilde/parti.
 */
type DisplayItem = {
  key: string;
  fullName: string;
  photoId: string | null;     // Stortinget personid for bilde; null = placeholder
  articleCount: number;
  partiLabel: string | null;
  subtitle: string;
  matchedPersonNavn: string | null;  // for onSelectPerson — null = ingen DB-data
};

/**
 * Fleksibel navnematching mellom Stortinget-data og DB-persondata.
 * Stortinget kan putte flere ord i "fornavn" (f.eks. "Lubna Boby" + "Jaffery"),
 * og DB-en kan ha forkortet form ("Lubna Jaffery"). Vi godtar:
 *  1) eksakt match,
 *  2) første token i fornavn + siste token i etternavn,
 *  3) alle fornavn- og etternavn-tokens er til stede.
 */
function nameMatches(personNavn: string, m: Rikspolitiker): boolean {
  const fullName = `${m.fornavn} ${m.etternavn}`.toLowerCase().trim();
  const pLc = personNavn.toLowerCase().trim();
  if (pLc === fullName) return true;

  const fornavnTokens = m.fornavn.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const etternavnTokens = m.etternavn.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const firstGiven = fornavnTokens[0] || '';
  const lastSurname = etternavnTokens[etternavnTokens.length - 1] || '';

  const parts = pLc.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || !firstGiven || !lastSurname) return false;

  if (parts[0] === firstGiven && parts[parts.length - 1] === lastSurname) return true;

  const pTokens = new Set(parts);
  if (fornavnTokens.every(t => pTokens.has(t)) && etternavnTokens.every(t => pTokens.has(t))) return true;

  return false;
}

/**
 * Kortkode for parti — brukes på badgen under bildet i "alle"-modus når
 * vi ikke har en Stortinget-match (og dermed ingen partiId). Ukjente partier
 * faller tilbake på initialer.
 */
const PARTI_SHORTCODE: Record<string, string> = {
  'Arbeiderpartiet': 'A',
  'Høyre': 'H',
  'Senterpartiet': 'Sp',
  'Sosialistisk Venstreparti': 'SV',
  'Fremskrittspartiet': 'FrP',
  'Venstre': 'V',
  'Kristelig Folkeparti': 'KrF',
  'Rødt': 'R',
  'Miljøpartiet De Grønne': 'MDG',
  'Pasientfokus': 'PF',
  'Industri- og Næringspartiet': 'INP',
  'Konservativt': 'K',
};

function partiShortLabel(parti: string | null | undefined): string | null {
  if (!parti) return null;
  if (PARTI_SHORTCODE[parti]) return PARTI_SHORTCODE[parti];
  const initials = parti
    .split(/\s+/)
    .map(w => w[0])
    .filter(Boolean)
    .join('')
    .toUpperCase();
  return initials.length > 0 && initials.length <= 4 ? initials : parti.slice(0, 3).toUpperCase();
}

/**
 * Grå placeholder-avatar med initialer — brukes når personen ikke finnes i
 * Stortinget-datasettet (typisk lokalpolitikere fra DB-en).
 */
function PlaceholderAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800">
      <span className="text-base font-bold text-gray-400 dark:text-gray-500 select-none">
        {initials || '?'}
      </span>
    </div>
  );
}

function RegjeringOversikt({
  personer,
  onSelectPerson
}: {
  personer: Person[];
  onSelectPerson: (fullName: string) => void;
}) {
  const [politikere, setPolitikere] = useState<Rikspolitiker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PolitikerFilter>('regjering');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [regRes, repRes] = await Promise.all([
          fetch('https://data.stortinget.no/eksport/regjering'),
          fetch(`https://data.stortinget.no/eksport/representanter?stortingsperiodeid=${STORTINGSPERIODE_ID}`),
        ]);
        if (!regRes.ok) throw new Error(`Regjering HTTP ${regRes.status}`);
        if (!repRes.ok) throw new Error(`Representanter HTTP ${repRes.status}`);

        const [regText, repText] = await Promise.all([regRes.text(), repRes.text()]);
        const parser = new DOMParser();

        // --- Parse regjering ---
        const regXml = parser.parseFromString(regText, 'text/xml');
        const regNodes = Array.from(regXml.getElementsByTagName('regjeringsmedlem'));
        const regjering: Rikspolitiker[] = regNodes.map(n => {
          const get = (tag: string) => n.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
          const partiNode = n.getElementsByTagName('parti')[0];
          const partiNavn = partiNode?.getElementsByTagName('navn')[0]?.textContent?.trim() || '';
          const partiId = partiNode?.getElementsByTagName('id')[0]?.textContent?.trim() || '';
          return {
            id: get('id'),
            fornavn: get('fornavn'),
            etternavn: get('etternavn'),
            parti: partiNavn,
            partiId,
            tittel: get('tittel'),
            kjoenn: get('kjoenn'),
            sortering: parseInt(get('sortering') || '999', 10),
            fylke: '',
            erRegjering: true,
            erVara: false,
          };
        });

        // --- Parse representanter ---
        const repXml = parser.parseFromString(repText, 'text/xml');
        const repNodes = Array.from(repXml.getElementsByTagName('representant'));
        const representanter: Rikspolitiker[] = repNodes.map(n => {
          const get = (tag: string) => n.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
          const partiNode = n.getElementsByTagName('parti')[0];
          const partiNavn = partiNode?.getElementsByTagName('navn')[0]?.textContent?.trim() || '';
          const partiId = partiNode?.getElementsByTagName('id')[0]?.textContent?.trim() || '';
          const fylkeNode = n.getElementsByTagName('fylke')[0];
          const fylkeNavn = fylkeNode?.getElementsByTagName('navn')[0]?.textContent?.trim() || '';
          const varaStr = get('vara_representant').toLowerCase();
          return {
            id: get('id'),
            fornavn: get('fornavn'),
            etternavn: get('etternavn'),
            parti: partiNavn,
            partiId,
            tittel: '',
            kjoenn: get('kjoenn'),
            sortering: 999,
            fylke: fylkeNavn,
            erRegjering: false,
            erVara: varaStr === 'true',
          };
        });

        // --- Dedup by id, regjering vinner (beholder tittel) ---
        const byId = new Map<string, Rikspolitiker>();
        for (const r of representanter) byId.set(r.id, r);
        for (const r of regjering) {
          const existing = byId.get(r.id);
          byId.set(r.id, {
            ...r,
            fylke: existing?.fylke || r.fylke,
            erVara: existing?.erVara || false,
          });
        }

        const merged = Array.from(byId.values());

        if (!cancelled) {
          setPolitikere(merged);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Kunne ikke hente rikspolitikere');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Bygg listen som skal vises. "alle" itererer DB-personer (alle navn vi har
  // omtale for, uavhengig av om de er i Stortinget-XML). De andre filtrene
  // itererer Stortinget-data og finner DB-match for klikkbarhet.
  const displayItems: DisplayItem[] = (() => {
    if (filter === 'alle') {
      return personer
        .map<DisplayItem>(p => {
          const m = politikere.find(rp => nameMatches(p.navn, rp));
          return {
            key: p.navn,
            fullName: p.navn,
            photoId: m?.id ?? null,
            articleCount: p.antallArtikler,
            partiLabel: m?.partiId ?? partiShortLabel(p.parti),
            subtitle: m?.tittel || m?.fylke || (m?.erVara ? 'Vararepresentant' : (p.valgdistrikt || '')),
            matchedPersonNavn: p.navn,
          };
        })
        .sort((a, b) =>
          b.articleCount - a.articleCount
          || a.fullName.localeCompare(b.fullName, 'no'));
    }

    return politikere
      .filter(p => filter === 'regjering' ? p.erRegjering : !p.erVara)
      .sort((a, b) => {
        // Regjering først sortert etter sortering, så representanter alfabetisk på etternavn
        if (a.erRegjering && b.erRegjering) return a.sortering - b.sortering;
        if (a.erRegjering) return -1;
        if (b.erRegjering) return 1;
        return a.etternavn.localeCompare(b.etternavn, 'no');
      })
      .map<DisplayItem>(m => {
        const p = personer.find(pp => nameMatches(pp.navn, m));
        return {
          key: m.id,
          fullName: `${m.fornavn} ${m.etternavn}`,
          photoId: m.id,
          articleCount: p?.antallArtikler ?? 0,
          partiLabel: m.partiId || null,
          subtitle: m.tittel || m.fylke || (m.erVara ? 'Vararepresentant' : ''),
          matchedPersonNavn: p?.navn ?? null,
        };
      });
  })();

  const filterLabels: Record<PolitikerFilter, string> = {
    regjering: 'Regjering',
    storting: 'Storting',
    alle: 'Alle',
  };

  const overskrift =
    filter === 'regjering' ? 'Regjeringen' :
    filter === 'storting'  ? 'Stortinget' :
                             'Alle politikere';

  return (
    <div className="mt-6 pt-5 border-t border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3" />
        </svg>
        <h4 className="text-sm font-bold tracking-tight">{overskrift}</h4>
        <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500 ml-auto">
          {loading ? 'Laster…' : error ? 'Feil' : `${displayItems.length}`}
        </span>
      </div>

      {/* Filter-pills */}
      {!loading && !error && (
        <div className="flex gap-1 p-1 bg-gray-100/70 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60 mb-3">
          {(Object.keys(filterLabels) as PolitikerFilter[]).map(k => {
            const active = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`flex-1 px-2 py-1 text-[11px] font-semibold rounded-md transition-all ${
                  active
                    ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-foreground'
                }`}
              >
                {filterLabels[k]}
              </button>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="w-[72px] h-[96px] animate-shimmer rounded-lg" />
              <div className="h-3 w-14 animate-shimmer rounded mt-2" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 sm:gap-4 max-h-[280px] overflow-y-auto sidebar-scrollbar pr-1">
          {displayItems.map(item => {
            const hasData = item.matchedPersonNavn !== null;
            const showCountBadge = hasData && item.articleCount > 0;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => hasData && onSelectPerson(item.matchedPersonNavn!)}
                disabled={!hasData}
                className={`flex flex-col items-center text-center group rounded-lg p-1 -m-1 transition-all ${
                  hasData
                    ? 'cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-900/20'
                    : 'opacity-60 cursor-not-allowed'
                }`}
                title={
                  hasData
                    ? `Se stats for ${item.fullName} (${item.articleCount} ${item.articleCount === 1 ? 'artikkel' : 'artikler'})`
                    : `${item.fullName} — ingen omtale i datasettet`
                }
              >
                <div className={`relative w-[72px] h-[96px] rounded-lg overflow-hidden border shadow-sm transition-all ${
                  hasData
                    ? 'border-gray-200 dark:border-gray-700 group-hover:shadow-md group-hover:-translate-y-0.5 group-hover:border-indigo-400 dark:group-hover:border-indigo-500'
                    : 'border-gray-200 dark:border-gray-700 grayscale'
                }`}>
                  {item.photoId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`https://data.stortinget.no/eksport/personbilde?personid=${encodeURIComponent(item.photoId)}&storrelse=lite&erstatningsbilde=true`}
                      alt={item.fullName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <PlaceholderAvatar name={item.fullName} />
                  )}
                  {showCountBadge && (
                    <span className="absolute top-1 right-1 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-indigo-600 text-white shadow-sm tabular-nums">
                      {item.articleCount}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] font-bold truncate max-w-full leading-tight">
                  {item.fullName}
                </p>
                {item.subtitle && (
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-full leading-tight mt-0.5">
                    {item.subtitle}
                  </p>
                )}
                {item.partiLabel && (
                  <span className="mt-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                    {item.partiLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Render én kompakt sentiment-pille med prefiks-label, brukt på kandidatraden
 * for å skille FAAR (om kandidaten) fra GIR (av kandidaten).
 *
 * Argmax over (neg, nøytral, pos) gir labelen — eksakt samme regel som
 * artikkel-pillen og som backend, så de tre kan ikke være uenige. Tallet i
 * pillen er konfidensen til den vinnende klassen.
 */
function MiniSentimentPill({ vec, count, prefix, tooltip }: {
  vec: SentimentVec;
  count: number;
  prefix: string;
  tooltip: string;
}) {
  if (count === 0) return null;
  const label = pickLabel(vec);
  const dominantPct =
    label === "POSITIV" ? vec.pos * 100
    : label === "NEGATIV" ? vec.neg * 100
    : vec.neutral * 100;
  const cls = label === "POSITIV" ? "kv-sentiment kv-sentiment-positive"
    : label === "NEGATIV" ? "kv-sentiment kv-sentiment-negative"
    : "kv-sentiment kv-sentiment-neutral";
  const text = label === "POSITIV" ? "Positiv" : label === "NEGATIV" ? "Negativ" : "Nøytral";
  const icon = label === "POSITIV" ? "▲" : label === "NEGATIV" ? "▼" : "■";
  return (
    <span className={cls} title={tooltip}>
      <span className="text-[9px] opacity-60 mr-1 font-bold uppercase tracking-wider">{prefix}</span>
      <span aria-hidden>{icon}</span>
      {text} · {dominantPct.toFixed(0)}%
    </span>
  );
}

function CandidateSentimentSummary({ person }: { person: Person }) {
  const faar = aggregateScores(person, 'faar');
  const gir = aggregateScores(person, 'gir');

  // Ingen sentiment-data i det hele tatt (verken FAAR eller GIR analysert)
  if (faar.count === 0 && gir.count === 0) {
    return (
      <span className="kv-sentiment kv-sentiment-neutral">
        Sentiment kommer
      </span>
    );
  }

  const formatTooltip = (kind: 'omtalt' | 'sier', vec: SentimentVec, count: number) => {
    const subject = kind === 'omtalt' ? 'Hvordan kandidaten omtales av andre' : 'Hvordan kandidaten omtaler andre';
    const artikler = `${count} ${count === 1 ? 'artikkel' : 'artikler'}`;
    return `${subject} (gjennomsnitt over ${artikler})\n`
      + `Negativ ${(vec.neg * 100).toFixed(0)}% · Nøytral ${(vec.neutral * 100).toFixed(0)}% · Positiv ${(vec.pos * 100).toFixed(0)}%`;
  };

  return (
    <div className="flex flex-col gap-1 items-end">
      <MiniSentimentPill
        vec={faar.vec}
        count={faar.count}
        prefix="Omtalt"
        tooltip={formatTooltip('omtalt', faar.vec, faar.count)}
      />
      <MiniSentimentPill
        vec={gir.vec}
        count={gir.count}
        prefix="Sier"
        tooltip={formatTooltip('sier', gir.vec, gir.count)}
      />
    </div>
  );
}

export default function DataDisplay({ data, isLoading, error, dateRange, onDateRangeChange, onResetDateFilter }: DataDisplayProps) {
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(null);
  const [showAllArticles, setShowAllArticles] = useState(false);
  const [showValidationWarning, setShowValidationWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!dateRange.fraDato && !dateRange.tilDato) {
      const minimumDate = kvasirApi.getMinimumDate();
      const today = new Date();
      onDateRangeChange({ fraDato: minimumDate, tilDato: today });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <div className="py-6 sm:py-8">
        <div className="space-y-6">
          <div className="h-8 w-64 animate-shimmer rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="kv-card p-6">
                <div className="h-4 w-24 animate-shimmer rounded mb-3" />
                <div className="h-8 w-16 animate-shimmer rounded" />
              </div>
            ))}
          </div>
          <div className="kv-card p-6">
            <div className="h-5 w-48 animate-shimmer rounded mb-4" />
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-6 w-full animate-shimmer rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6 sm:py-8">
        <div className="kv-card p-5 sm:p-6 border-red-200 dark:border-red-900" style={{ background: 'rgba(239, 68, 68, 0.05)' }}>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold">!</div>
            <div className="min-w-0">
              <h3 className="text-red-800 dark:text-red-300 font-semibold">Kunne ikke laste data</h3>
              <p className="text-red-700 dark:text-red-400 text-sm mt-1 break-words">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const allePartier = Object.entries(data.partiProsentFordeling)
    .sort(([, a], [, b]) => (b as number) - (a as number));

  const sortedPersoner = [...data.allePersonernevnt].sort((a, b) => b.antallArtikler - a.antallArtikler);
  const displayedPersoner = showAllCandidates ? sortedPersoner : sortedPersoner.slice(0, 10);

  const toggleExpandCandidate = (candidateName: string) => {
    setExpandedCandidate(expandedCandidate === candidateName ? null : candidateName);
    setShowAllArticles(false);
  };

  // Når man trykker på et regjeringsmedlem: expand kandidaten og scroll dit
  const handleSelectFromRegjering = (fullName: string) => {
    // Finn kandidaten — må være i datasettet for å kunne klikkes (RegjeringOversikt sjekker dette)
    const sorted = [...(data?.allePersonernevnt || [])].sort((a, b) => b.antallArtikler - a.antallArtikler);
    const index = sorted.findIndex(p => p.navn.toLowerCase() === fullName.toLowerCase());
    if (index === -1) return;

    // Sikre at kandidaten er synlig (top 10 eller alle)
    if (index >= 10) setShowAllCandidates(true);

    setExpandedCandidate(fullName);
    setShowAllArticles(false);

    // Scroll til kandidat-raden etter render
    setTimeout(() => {
      const el = document.getElementById(`kandidat-${fullName}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
  };

  const getSourceDisplayName = (kilde: string) => {
    switch (kilde.toLowerCase()) {
      case 'vg': return 'VG';
      case 'nrk': return 'NRK';
      case 'e24': return 'E24';
      case 'dagbladet': return 'DAGBLADET';
      case 'alt': return 'Alle kilder';
      default: return kilde.toUpperCase();
    }
  };

  // Antall artikler med faktisk sentiment-analyse
  const sentimentAnalysedCount = data.allePersonernevnt.reduce(
    (acc, p) => acc + p.lenker.filter(hasSentiment).length, 0
  );
  const sentimentCoverage = data.totaltAntallArtikler > 0
    ? (sentimentAnalysedCount / data.totaltAntallArtikler) * 100
    : 0;

  return (
    <div className="py-6 sm:py-8 max-w-none xl:max-w-7xl 2xl:max-w-none">
      {showValidationWarning && (
        <div className="fixed top-0 left-0 w-full z-50 flex justify-center animate-slideDown">
          <div className="mt-4 px-6 py-3 bg-red-600 text-white rounded-lg shadow-lg flex items-center gap-2 border border-red-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-base font-medium">{showValidationWarning}</span>
            <button onClick={() => setShowValidationWarning(null)} className="ml-4 text-white hover:text-red-200 text-lg font-bold">×</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-10 animate-fade-in-up">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="kv-badge kv-badge-gradient kv-animated-grad">
            <span className="kv-live-dot" /> {getSourceDisplayName(data.kilde)}
          </span>
          {(dateRange.fraDato || dateRange.tilDato) && (
            <span className="kv-badge">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {dateRange.fraDato && dateRange.tilDato
                ? `${kvasirApi.formatNorwegianDate(dateRange.fraDato)} – ${kvasirApi.formatNorwegianDate(dateRange.tilDato)}`
                : dateRange.fraDato
                ? `Fra ${kvasirApi.formatNorwegianDate(dateRange.fraDato)}`
                : dateRange.tilDato
                ? `Til ${kvasirApi.formatNorwegianDate(dateRange.tilDato)}`
                : null}
            </span>
          )}
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold mb-3 tracking-tight leading-[1.05]">
          <span className="kv-grad-text kv-animated-grad">Kandidatanalyse</span>
        </h1>
        <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 max-w-2xl">
          <span className="font-semibold text-foreground tabular-nums">{data.totaltAntallArtikler.toLocaleString('no-NO')}</span> artikler ·
          <span className="font-semibold text-foreground tabular-nums"> {data.allePersonernevnt.length.toLocaleString('no-NO')}</span> unike kandidater
          {sentimentAnalysedCount > 0 && (
            <> · <span className="kv-grad-text-emerald font-semibold">{sentimentCoverage.toFixed(0)}% sentiment-analysert</span></>
          )}
        </p>
      </div>

      <DateRangeSelector
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        onResetDateFilter={onResetDateFilter}
        setShowValidationWarning={setShowValidationWarning}
      />

      {/* Hovedstatistikk */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5 mb-10">
        <StatCard
          title="Totalt artikler"
          value={data.totaltAntallArtikler.toLocaleString('no-NO')}
          variant="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
          }
        />
        <StatCard
          title="Unike kandidater"
          value={data.allePersonernevnt.length.toLocaleString('no-NO')}
          variant="green"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />
        <StatCard
          title="Gj.snitt alder"
          value={`${data.gjennomsnittligAlder.toFixed(1)}`}
          hint="år"
          variant="purple"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Kjønn + Parti side-om-side på større skjermer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10 items-start">
        {Object.keys(data.kjoennProsentFordeling).length > 0 && (
          <div className="kv-card kv-card-hover p-5 sm:p-6 animate-fade-in-up">
            <div className="flex items-center gap-3 mb-5">
              <div className="kv-icon-badge kv-icon-badge-blue">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold tracking-tight">Kjønnsfordeling</h3>
            </div>
            <div className="space-y-4">
              {Object.entries(data.kjoennProsentFordeling).map(([kjonn, prosent]) => (
                <div key={kjonn} className="flex items-center justify-between gap-3">
                  <span className="capitalize text-sm font-semibold min-w-[64px]">{kjonn}</span>
                  <div className="flex items-center gap-3 flex-1 max-w-xs">
                    <div className="kv-bar-track flex-1">
                      <div className="kv-bar-fill kv-bar-fill-blue" style={{ width: `${prosent}%` }} />
                    </div>
                    <span className="text-sm font-bold tabular-nums min-w-[52px] text-right">
                      {prosent.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <RegjeringOversikt
              personer={data.allePersonernevnt}
              onSelectPerson={handleSelectFromRegjering}
            />
          </div>
        )}

        <div className="kv-card kv-card-hover p-5 sm:p-6 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="kv-icon-badge kv-icon-badge-emerald">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 15l4-4 4 4 5-5" />
              </svg>
            </div>
            <h3 className="text-lg font-bold tracking-tight">Partifordeling</h3>
            <span className="ml-auto text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">
              {allePartier.length} partier
            </span>
          </div>
          <div className="space-y-3.5 max-h-[380px] overflow-y-auto sidebar-scrollbar pr-1">
            {allePartier.map(([parti, prosent]) => {
              const antallGanger = data.partiMentions[parti] || 0;
              return (
                <div key={parti} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold truncate flex-1" title={parti}>{parti}</span>
                  <div className="flex items-center gap-3 flex-1 max-w-[240px]">
                    <div className="kv-bar-track flex-1">
                      <div className="kv-bar-fill kv-bar-fill-emerald" style={{ width: `${prosent}%` }} />
                    </div>
                    <span className="text-xs font-bold tabular-nums min-w-[76px] text-right">
                      {prosent.toFixed(1)}% <span className="text-gray-400 font-medium">({antallGanger})</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Kandidater */}
      <div className="kv-card p-5 sm:p-6 animate-fade-in-up">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="kv-icon-badge kv-icon-badge-purple">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.915a1 1 0 00.95-.69l1.519-4.674z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-bold tracking-tight">
                {showAllCandidates
                  ? `Alle kandidater`
                  : 'Top 10 mest omtalte'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {showAllCandidates
                  ? `${data.allePersonernevnt.length} kandidater totalt`
                  : `Av totalt ${data.allePersonernevnt.length} kandidater`}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAllCandidates(!showAllCandidates)}
            className="px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-all w-fit shadow-md hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
          >
            {showAllCandidates ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
                Vis bare top 10
              </>
            ) : (
              <>
                Se alle {data.allePersonernevnt.length}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </>
            )}
          </button>
        </div>

        <div className="space-y-2.5">
          {displayedPersoner.map((person, index) => {
            const isExpanded = expandedCandidate === person.navn;
            // Sorter artikler kronologisk — nyeste først
            const sortedLenker = person.lenker
              ? [...person.lenker].sort((a, b) => {
                  const da = new Date(a.scraped).getTime();
                  const db = new Date(b.scraped).getTime();
                  return db - da;
                })
              : [];
            return (
              <div
                key={person.navn}
                id={`kandidat-${person.navn}`}
                className={`kv-card kv-card-hover overflow-hidden scroll-mt-24 ${isExpanded ? 'ring-2 ring-indigo-400/40 dark:ring-indigo-500/40' : ''}`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpandCandidate(person.navn)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleExpandCandidate(person.navn); }}
                  className="flex items-center gap-3 sm:gap-4 p-3.5 sm:p-4 cursor-pointer hover:bg-gradient-to-r hover:from-indigo-50/50 hover:to-transparent dark:hover:from-indigo-900/10 dark:hover:to-transparent transition-all"
                >
                  <div className={`kv-rank ${index < 3 ? 'kv-rank-top' : 'kv-rank-default'}`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm sm:text-base truncate tracking-tight">{person.navn}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {person.parti} · {person.valgdistrikt}
                      {person.alder ? ` · ${person.alder} år` : ''}
                      {person.kjoenn ? ` · ${person.kjoenn}` : ''}
                    </p>
                  </div>
                  <div className="hidden sm:block">
                    <CandidateSentimentSummary person={person} />
                  </div>
                  <div className="text-right flex-shrink-0 min-w-[60px]">
                    <p className="font-extrabold kv-grad-text tabular-nums text-xl leading-none">
                      {person.antallArtikler}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 mt-1 font-bold">artikler</p>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {isExpanded && sortedLenker.length > 0 && (
                  <div className="p-4 sm:p-5 border-t border-gray-200 dark:border-gray-800 bg-gradient-to-b from-gray-50/60 to-transparent dark:from-gray-900/60 dark:to-transparent">
                    {/* Mobil: stables vertikalt så pillene får egen rad og ikke skvises av "Artikler · 5 · Nyeste først". */}
                    <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h5 className="text-sm font-bold text-gray-700 dark:text-gray-200 tracking-tight">
                          Artikler
                        </h5>
                        <span className="kv-badge">{sortedLenker.length}</span>
                        <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">
                          Nyeste først
                        </span>
                      </div>
                      <div className="sm:hidden">
                        <CandidateSentimentSummary person={person} />
                      </div>
                    </div>
                    <div className="space-y-3 max-h-[520px] overflow-y-auto sidebar-scrollbar pr-1">
                      {(showAllArticles ? sortedLenker : sortedLenker.slice(0, 20)).map((artikkel, linkIndex) => (
                        <ArticleWithSummary
                          key={artikkel.lenke + linkIndex}
                          artikkel={artikkel}
                          index={linkIndex}
                        />
                      ))}
                      {!showAllArticles && sortedLenker.length > 20 && (
                        <button
                          onClick={() => setShowAllArticles(true)}
                          className="w-full py-2.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                        >
                          Vis alle {sortedLenker.length} artikler
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {showAllCandidates && data.allePersonernevnt.length > 10 && (
          <p className="mt-5 text-center text-xs text-gray-500 dark:text-gray-400">
            Viser alle <span className="font-bold text-foreground">{data.allePersonernevnt.length}</span> kandidater
          </p>
        )}
      </div>
    </div>
  );
}
