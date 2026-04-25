// API Types basert på Java DTOs

export type SentimentLabel = 'POSITIV' | 'NEGATIV' | 'NOYTRAL';

export interface ArtikelDTO {
  lenke: string;
  scraped: string; // ISO date string fra backend (LocalDate)
  // Sentiment: hvordan politikeren omtaler andre ("gir")
  girSentiment: SentimentLabel | null;
  girPositivScore: number | null;
  girNoytralScore: number | null;
  girNegativScore: number | null;
  // Sentiment: hvordan politikeren blir omtalt av andre ("får")
  faarSentiment: SentimentLabel | null;
  faarPositivScore: number | null;
  faarNoytralScore: number | null;
  faarNegativScore: number | null;
}

export interface Person {
  navn: string;
  alder: number | null;
  kjoenn: string | null;
  parti: string;
  valgdistrikt: string;
  lenker: ArtikelDTO[];
  antallArtikler: number;
}

export interface DataDTO {
  gjennomsnittligAlder: number;
  totaltAntallArtikler: number;
  allePersonernevnt: Person[];
  kjoennRatio: Record<string, number>;
  kjoennProsentFordeling: Record<string, number>;
  partiMentions: Record<string, number>;
  partiProsentFordeling: Record<string, number>;
  kilde: string;
}

export interface SammendragDTO {
  id: number;
  link: string;
  sammendrag: string;
  kompresjonRatio: number;
  antallOrdOriginal: number;
  antallOrdSammendrag: number;
}

export interface PersonSentimentDTO {
  personNavn: string;
  girSentiment: SentimentLabel | null;
  girPositivScore: number | null;
  girNoytralScore: number | null;
  girNegativScore: number | null;
  faarSentiment: SentimentLabel | null;
  faarPositivScore: number | null;
  faarNoytralScore: number | null;
  faarNegativScore: number | null;
}

export type ApiKilde = 'vg' | 'nrk' | 'e24' | 'dagbladet' | 'alt';

export interface ApiError {
  message: string;
  status: number;
}

// Nye typer for datofiltrering
export interface DateRange {
  fraDato: Date | null;
  tilDato: Date | null;
}

export interface AnalyseRequestParams {
  kilde: ApiKilde;
  fraDato?: string; // ISO datetime string
  tilDato?: string;  // ISO datetime string
}
