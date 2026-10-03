import type {StyleSpecification} from 'maplibre-gl'

const ROUTE_BLUE = '#3E9BFF'

/** Owned client style. One public raster, no key, no style JSON hosted elsewhere.
 *  The route source is part of the style so the Tesla-blue line sits above the imagery
 *  as soon as the style loads. Filling it is a setData, not a late addLayer. */
export const satelliteStyle: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
    route: {
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []},
    },
  },
  layers: [
    {id: 'satellite', type: 'raster', source: 'satellite'},
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': '#0A3F9E', 'line-width': 10, 'line-opacity': 0.95},
    },
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': ROUTE_BLUE, 'line-width': 6, 'line-opacity': 1},
    },
  ],
}
