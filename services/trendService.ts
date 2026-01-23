
import { ApiResponse, QueryParams, UserConfig, SearchEndpoint } from '../types';

/**
 * The API Key provided for authentication.
 * This xoxo constant is the primary bearer token used for all XDR requests.
 */

const trendApiKey = import.meta.env.VITE_TREND_API_KEY
export class TrendMicroService {
  private region: string;

  constructor(config: UserConfig) {
    this.region = config.region.toLowerCase();
  }

  async search(endpoint: SearchEndpoint, query: string, params: QueryParams): Promise<ApiResponse> {
    // Sanitize the query: Headers MUST NOT contain newlines or non-ASCII characters
    const sanitizedQuery = query.replace(/\r?\n|\r/g, " ").trim();
    
    // Construct local proxy path
    const proxyPath = `/api/trendmicro/${this.region}/${endpoint}`;
    
    // Build URLSearchParams
    const urlParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        urlParams.append(key, String(value));
      }
    });

    const fullUrl = `${proxyPath}?${urlParams.toString()}`;
    
    console.info(`[XDR] Requesting: ${fullUrl}`);

    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${trendApiKey}`,
          'TMV1-Query': sanitizedQuery,
          'Accept': 'application/json'
        }
      });

      console.debug(`[XDR] HTTP Status: ${response.status} (${response.statusText})`);

      if (!response.ok) {
        const text = await response.text();
        console.error(`[XDR] Server responded with error: ${text}`);
        let errorMsg = `Error ${response.status}: ${response.statusText}`;
        try {
          const json = JSON.parse(text);
          errorMsg = json.error?.message || json.message || errorMsg;
        } catch (e) {}
        throw new Error(errorMsg);
      }

      const data = await response.json();
      console.info(`[XDR] Data received. Items: ${data.items?.length || 0}`);
      return data;
    } catch (error: any) {
      console.error('[XDR] Transmission Failure:', error);
      throw error;
    }
  }
}
