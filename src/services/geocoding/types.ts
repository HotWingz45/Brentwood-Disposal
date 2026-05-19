export interface GeocodeResult {
  success: true;
  lat: number;
  lng: number;
  placeId: string;
  formattedAddress: string;
  locationType: string;
}

export interface GeocodeFailure {
  success: false;
  error: string;
}

export type GeocodeOutcome = GeocodeResult | GeocodeFailure;

export interface BatchProgress {
  resolved: number;
  failed: number;
  total: number;
}

// Raw shape returned by the Google Geocoding REST API
export interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: {
      location: { lat: number; lng: number };
      location_type: 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE';
    };
    place_id: string;
    address_components: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
  error_message?: string;
}
