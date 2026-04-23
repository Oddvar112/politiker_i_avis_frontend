import { DataDTO, ApiKilde, SammendragDTO, PersonSentimentDTO } from '@/types/api';

const API_BASE_URL = 'https://api.kvasirsbrygg.no';

class KvasirApiService {
  private async fetchApi<T>(endpoint: string): Promise<T> {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new ApiError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        'Live oppdatering fra databasen er ikke tilgjengelig da valget er over for denne gang. Hvis du vil ha tilgang til data, send en e-post til hanev@online.no.',
        0
      );
    }
  }

  /**
   * Bygger query string fra parametere
   */
  private buildQueryString(params: Record<string, string | undefined>): string {
    const queryParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, value);
      }
    });

    const queryString = queryParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  /**
   * Henter analyse data for en spesifik kilde
   * @param kilde - Hvilken kilde å hente data for ('vg', 'nrk', 'e24', 'dagbladet', 'alt')
   * @param fraDato - Valgfri fra-dato (Date objekt)
   * @param tilDato - Valgfri til-dato (Date objekt)
   * @returns Promise med analyse data
   */
  async getAnalyseData(kilde: ApiKilde, fraDato?: Date, tilDato?: Date): Promise<DataDTO> {
    const params: Record<string, string | undefined> = {};
    
    if (fraDato) {
      // Konverterer Date til ISO datetime string som backend forventer
      params.fraDato = fraDato.toISOString();
    }
    
    if (tilDato) {
      // Setter til slutten av dagen for tilDato
      const endOfDay = new Date(tilDato);
      endOfDay.setHours(23, 59, 59, 999);
      params.tilDato = endOfDay.toISOString();
    }

    const queryString = this.buildQueryString(params);
    return this.fetchApi<DataDTO>(`/api/analyse/${kilde}${queryString}`);
  }

  /**
   * Henter sammendrag for en spesifikk artikkel-link
   * @param link - URL til artikkelen
   * @returns Promise med sammendrag data eller null hvis ikke funnet
   */
  async getSammendrag(link: string): Promise<SammendragDTO | null> {
    try {
      const encodedLink = encodeURIComponent(link);
      return await this.fetchApi<SammendragDTO>(`/api/analyse/sammendrag?link=${encodedLink}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Henter sentiment (GIR/FAAR) for alle politikere nevnt i en gitt artikkel.
   * @param link URL til artikkelen
   * @returns Liste av PersonSentimentDTO, eller tom liste hvis ingenting finnes
   */
  async getArtikelSentiment(link: string): Promise<PersonSentimentDTO[]> {
    try {
      const encodedLink = encodeURIComponent(link);
      return await this.fetchApi<PersonSentimentDTO[]>(
        `/api/artikkel/sentiment?link=${encodedLink}`
      );
    } catch (error) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Henter alle kilder samtidig for sammenligning
   * @param fraDato - Valgfri fra-dato for alle kilder
   * @param tilDato - Valgfri til-dato for alle kilder
   * @returns Promise med data for alle kilder
   */
  async getAlleKilder(fraDato?: Date, tilDato?: Date): Promise<{
    vg: DataDTO;
    nrk: DataDTO;
    e24: DataDTO;
    dagbladet: DataDTO;
    alt: DataDTO;
  }> {
    const [vg, nrk, e24, dagbladet, alt] = await Promise.all([
      this.getAnalyseData('vg', fraDato, tilDato),
      this.getAnalyseData('nrk', fraDato, tilDato),
      this.getAnalyseData('e24', fraDato, tilDato),
      this.getAnalyseData('dagbladet', fraDato, tilDato),
      this.getAnalyseData('alt', fraDato, tilDato),
    ]);

    return { vg, nrk, e24, dagbladet, alt };
  }

  /**
   * Sjekker om APIet er tilgjengelig
   * @returns Promise som resolves til true hvis APIet responderer
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.fetchApi<unknown>('/api/analyse/alt');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Henter minimum tilgjengelig dato for data
   * Returnerer den første datoen vi har data fra (2025-07-24)
   */
  getMinimumDate(): Date {
    return new Date('2025-07-24T17:31:41.515607');
  }

  /**
   * Formaterer Date til norsk datoformat
   */
  formatNorwegianDate(date: Date): string {
    return date.toLocaleDateString('no-NO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  /**
   * Formaterer Date til norsk dato og tid format
   */
  formatNorwegianDateTime(date: Date): string {
    return date.toLocaleDateString('no-NO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

// Singleton instance
export const kvasirApi = new KvasirApiService();

// Custom error class
class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}