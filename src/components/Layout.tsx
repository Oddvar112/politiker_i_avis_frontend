"use client";

import { useEffect, useState } from "react";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import { kvasirApi } from "../services/kvasirApi";
import type { ApiKilde, DataDTO, DateRange } from "@/types/api";
import DataDisplay from "./DataDisplay";

interface LayoutProps {
  children?: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [kilde, setKilde] = useState<ApiKilde>("alt");
  const [data, setData] = useState<DataDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({
    fraDato: null,
    tilDato: null
  });

  // Automatisk redirect ut av Messenger WebView
  useEffect(() => {
    const isMessenger = /FBAN|FBAV|Messenger/i.test(navigator.userAgent);
    if (isMessenger && typeof window !== 'undefined') {
      const currentUrl = window.location.href;
      if (/Android/i.test(navigator.userAgent)) {
        window.location.href = `intent://${currentUrl.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`;
      } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        alert('Vennligst åpne denne siden i Safari for best opplevelse. Trykk på de tre prikkene øverst til høyre og velg "Åpne i Safari"');
      }
    }
  }, []);

  // Funksjon for å laste data med valgfri datofiltrering
  const loadData = async (selectedKilde: ApiKilde, fraDato?: Date | null, tilDato?: Date | null) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await kvasirApi.getAnalyseData(
        selectedKilde,
        fraDato || undefined,
        tilDato || undefined
      );
      setData(result);
    } catch (err: unknown) {
      if (err instanceof Error) {
        const friendlyMessage =
          err.message.includes("Network error") || err.message.includes("Could not connect to API")
            ? "Live oppdatering fra databasen er ikke tilgjengelig da valget er over for denne gang. Hvis du vil ha tilgang til data, send en e-post til hanev@online.no."
            : err.message;
        setError(friendlyMessage);
      } else {
        setError("Ukjent feil");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Initial data loading ved oppstart
  useEffect(() => {
    loadData(kilde);
  }, [kilde]);

  // Håndterer endring av datofilter
  const handleDateRangeChange = (newDateRange: DateRange) => {
    setDateRange(newDateRange);
    loadData(kilde, newDateRange.fraDato, newDateRange.tilDato);
  };

  // Håndterer endring av kilde
  const handleKildeSelect = (newKilde: ApiKilde) => {
    setKilde(newKilde);
    setSidebarOpen(false); // Lukk sidebar på mobil etter valg
    // Data lastes automatisk via useEffect når kilde endres
  };

  // Reset datofilter
  const handleResetDateFilter = () => {
    const resetRange = { fraDato: null, tilDato: null };
    setDateRange(resetRange);
    loadData(kilde, null, null);
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
      <Sidebar 
        onSelect={handleKildeSelect} 
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      
      {/* Overlay for mobil når sidebar er åpen */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Hovedinnhold med responsiv padding */}
      <main className="pt-14 lg:pl-80 xl:pl-96 2xl:pl-80">
        <div className="px-4 sm:px-6 lg:px-8 xl:px-12 2xl:px-16">
          <DataDisplay 
            data={data} 
            isLoading={isLoading} 
            error={error}
            dateRange={dateRange}
            onDateRangeChange={handleDateRangeChange}
            onResetDateFilter={handleResetDateFilter}
          />
          {children}
        </div>
      </main>
    </div>
  );
}