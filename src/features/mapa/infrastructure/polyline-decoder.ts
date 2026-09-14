/**
 * Decodificador de polyline no formato Google/OSRM.
 *
 * O OSRM retorna geometrias codificadas com o algoritmo polyline
 * do Google Maps. Esta função decodifica para array de [lat, lon].
 *
 * Referência: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

import type { GeoPoint } from '../domain/routing';

export function decodePolyline(encoded: string): GeoPoint[] {
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;

    // Decodifica latitude
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    // Decodifica longitude
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }

  return points;
}
