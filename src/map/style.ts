import type {ExpressionSpecification, StyleSpecification} from 'maplibre-gl'

const ROUTE_BLUE = '#3E9BFF'

/** OpenFreeMap planet vector tiles. No key. Overlay only; the Esri raster stays the basemap. */
const OPENFREEMAP = 'https://tiles.openfreemap.org/planet'

/** Street basemap. No key. Liberty already draws roads, labels, land, and buildings. */
export const LIBERTY_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

const labelName: ExpressionSpecification = ['coalesce', ['get', 'name_en'], ['get', 'name']]

/** render_height, else building:levels * 3, else about 8m. OpenFreeMap buildings carry render_height. */
const buildingHeight: ExpressionSpecification = [
  'case',
  ['>', ['to-number', ['coalesce', ['get', 'render_height'], 0]], 0],
  ['to-number', ['get', 'render_height']],
  ['>', ['to-number', ['coalesce', ['get', 'building:levels'], 0]], 0],
  ['*', ['to-number', ['get', 'building:levels']], 3],
  8,
]

const labelLayout: { 'text-field': ExpressionSpecification, 'text-font': string[], 'text-size': number } = {
  'text-field': labelName,
  'text-font': ['Noto Sans Regular'],
  'text-size': 13,
}

const labelPaint = {
  'text-color': '#f7f8fa',
  'text-halo-color': '#121418',
  'text-halo-width': 1.4,
  'text-halo-blur': 0.2,
}

/** Owned client style. Esri World Imagery stays the only basemap. Vector layers are overlays. */
export const satelliteStyle: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
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
    openfreemap: {
      type: 'vector',
      url: OPENFREEMAP,
      attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    },
    route: {
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []},
    },
  },
  layers: [
    {id: 'satellite', type: 'raster', source: 'satellite'},
    {
      id: 'buildings-walls',
      type: 'fill-extrusion',
      source: 'openfreemap',
      'source-layer': 'building',
      minzoom: 14,
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: {
        'fill-extrusion-color': '#6a6762',
        'fill-extrusion-opacity': 0.55,
        'fill-extrusion-vertical-gradient': true,
        'fill-extrusion-base': ['to-number', ['coalesce', ['get', 'render_min_height'], 0]],
        'fill-extrusion-height': buildingHeight,
      },
    },
    {
      id: 'buildings-roofs',
      type: 'fill-extrusion',
      source: 'openfreemap',
      'source-layer': 'building',
      minzoom: 14,
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: {
        'fill-extrusion-color': [
          'case',
          ['all', ['has', 'colour'], ['!=', ['get', 'colour'], '']],
          ['get', 'colour'],
          '#efeae2',
        ],
        'fill-extrusion-opacity': 0.9,
        'fill-extrusion-vertical-gradient': false,
        'fill-extrusion-base': ['max', ['to-number', ['coalesce', ['get', 'render_min_height'], 0]], ['-', buildingHeight, 1.6]],
        'fill-extrusion-height': buildingHeight,
      },
    },
    {
      id: 'road-names',
      type: 'symbol',
      source: 'openfreemap',
      'source-layer': 'transportation_name',
      minzoom: 13,
      filter: ['has', 'name'],
      layout: {
        ...labelLayout,
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 16, 14],
      },
      paint: labelPaint,
    },
    {
      id: 'place-names',
      type: 'symbol',
      source: 'openfreemap',
      'source-layer': 'place',
      minzoom: 4,
      filter: ['match', ['get', 'class'], ['country', 'state', 'city', 'town', 'village', 'suburb', 'neighbourhood', 'hamlet', 'quarter'], true, false],
      layout: {
        ...labelLayout,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 8, 13, 12, 15],
        'text-max-width': 8,
      },
      paint: labelPaint,
    },
    {
      id: 'poi-names',
      type: 'symbol',
      source: 'openfreemap',
      'source-layer': 'poi',
      minzoom: 15,
      filter: ['has', 'name'],
      layout: {
        ...labelLayout,
        'text-size': 11,
        'text-max-width': 8,
      },
      paint: labelPaint,
    },
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
