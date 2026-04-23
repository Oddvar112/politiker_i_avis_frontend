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

function hasSentiment(a: ArtikelDTO): boolean {
  return !!(a.girSentiment || a.faarSentiment);
}

/** Beregner en aggregert sentiment-score (-1 til 1) per person basert på faar-scores. */
function aggregateFaarScore(person: Person): { avg: number; count: number } {
  const scored = person.lenker.filter(l => l.faarPositivScore !== null && l.faarNegativScore !== null);
  if (scored.length === 0) return { avg: 0, count: 0 };
  const sum = scored.reduce((acc, l) => acc + ((l.faarPositivScore || 0) - (l.faarNegativScore || 0)), 0);
  return { avg: sum / scored.length, count: scored.length };
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

function SentimentBar({ positive, negative }: { positive: number | null; negative: number | null }) {
  if (positive === null || negative === null) return null;
  const total = positive + negative;
  const posWidth = total > 0 ? (positive / total) * 100 : 50;
  const negWidth = 100 - posWidth;
  return (
    <div className="flex items-center gap-2 w-full">
      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold min-w-[32px]">
        {(positive * 100).toFixed(0)}%
      </span>
      <div className="kv-sentiment-bar flex-1">
        <div className="kv-sentiment-bar-positive" style={{ width: `${posWidth}%` }} />
        <div className="kv-sentiment-bar-negative" style={{ width: `${negWidth}%` }} />
      </div>
      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold min-w-[32px] text-right">
        {(negative * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function SentimentRow({
  heading,
  label,
  positive,
  negative,
  help
}: {
  heading: string;
  label: SentimentLabel | null;
  positive: number | null;
  negative: number | null;
  help: string;
}) {
  if (!label && positive === null && negative === null) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{heading}</span>
          <span
            className="text-[10px] text-gray-400 dark:text-gray-500 cursor-help"
            title={help}
          >
            ⓘ
          </span>
        </div>
        <SentimentPill label={label} />
      </div>
      <SentimentBar positive={positive} negative={negative} />
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
                heading="Hvordan kandidaten omtaler"
                help="Sentiment i setninger hvor kandidaten er objektet – altså hvordan andre omtaler personen."
                label={artikkel.faarSentiment}
                positive={artikkel.faarPositivScore}
                negative={artikkel.faarNegativScore}
              />
              <SentimentRow
                heading="Hvordan kandidaten omtaler annet"
                help="Sentiment i setninger hvor kandidaten er subjektet – altså hvordan personen omtaler andre."
                label={artikkel.girSentiment}
                positive={artikkel.girPositivScore}
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

  return (
    <div className="kv-card p-5 sm:p-6 mb-8 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{ background: 'radial-gradient(600px 200px at 10% 0%, #4f46e5, transparent 60%)' }}
      />
      <div className="relative flex flex-col lg:flex-row lg:items-end gap-5">
        <div className="flex-1 flex items-center gap-4">
          <div className="kv-icon-badge kv-icon-badge-blue">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight">Tidsrom</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Data fra <span className="font-medium text-foreground">{kvasirApi.formatNorwegianDate(minimumDate)}</span> til i dag
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex flex-col gap-1.5">
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
              className="px-3.5 py-2.5 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-xl bg-white/70 dark:bg-gray-900/70 backdrop-blur text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-400 shadow-sm hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1.5">
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
              className="px-3.5 py-2.5 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-xl bg-white/70 dark:bg-gray-900/70 backdrop-blur text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-400 shadow-sm hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            />
          </div>
          {hasActiveFilter && (
            <button
              onClick={onResetDateFilter}
              className="px-4 py-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-800/60 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-white dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 transition-all shadow-sm flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Tilbakestill
            </button>
          )}
        </div>
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

function CandidateSentimentSummary({ person }: { person: Person }) {
  const { avg, count } = aggregateFaarScore(person);
  if (count === 0) {
    return (
      <span className="kv-sentiment kv-sentiment-neutral">
        Sentiment kommer
      </span>
    );
  }
  const pct = Math.max(-100, Math.min(100, avg * 100));
  const tone = pct > 20 ? "positive" : pct < -20 ? "negative" : "neutral";
  const cls = tone === "positive" ? "kv-sentiment kv-sentiment-positive"
    : tone === "negative" ? "kv-sentiment kv-sentiment-negative"
    : "kv-sentiment kv-sentiment-neutral";
  const text = tone === "positive" ? "Positiv" : tone === "negative" ? "Negativ" : "Nøytral";
  return (
    <span className={cls} title={`Gjennomsnittlig sentiment på tvers av ${count} analyserte artikler`}>
      <span aria-hidden>{tone === "positive" ? "▲" : tone === "negative" ? "▼" : "■"}</span>
      {text} · {pct > 0 ? "+" : ""}{pct.toFixed(0)}
    </span>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10">
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
          <div className="space-y-3.5 max-h-[420px] overflow-y-auto sidebar-scrollbar pr-1">
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
                className={`kv-card kv-card-hover overflow-hidden ${isExpanded ? 'ring-2 ring-indigo-400/40 dark:ring-indigo-500/40' : ''}`}
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
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
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
